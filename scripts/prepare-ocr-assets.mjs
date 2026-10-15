import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const MODELS=[
  {language:'tha',bytes:896631,sha256:'4550a5505184d1b79cf10416d5b19e643001d95411d5e717954dd26feef3ae74'},
  {language:'eng',bytes:2952873,sha256:'45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91'}
];
const VARIANTS=['lstm','simd-lstm','relaxedsimd-lstm'];
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
function validateModel(bytes,model){
  if(bytes.length!==model.bytes||checksum(bytes)!==model.sha256)throw Error('OCR '+model.language+' model did not match its pinned checksum.');
  if(bytes[0]!==31||bytes[1]!==139)throw Error('OCR language data was not a gzip file.');
  // Bound decompression at build time as well as checking the upstream checksum.
  const raw=gunzipSync(bytes,{maxOutputLength:8*1024*1024});
  if(raw.length<100000)throw Error('OCR language data was unexpectedly small.');
}
async function pinnedModel(root,model){
  const cache=path.join(root,'.cache/ocr');await mkdir(cache,{recursive:true});
  const location=path.join(cache,model.language+'.traineddata.gz');
  try{const cached=await readFile(location);validateModel(cached,model);return cached;}catch{ /* Fetch missing or invalid cache contents. */ }
  const url=`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${model.language}/4.0.0_best_int/${model.language}.traineddata.gz`;
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error(`OCR model download returned HTTP ${response.status}.`);
      const bytes=Buffer.from(await response.arrayBuffer());validateModel(bytes,model);
      await writeFile(location,bytes);return bytes;
    }catch(error){lastError=error;}
  }
  throw new Error('Unable to prepare the pinned '+model.language+' OCR model. Retry the build with network access.',{cause:lastError});
}
export async function prepareOcrAssets(root,destination){
  await mkdir(destination,{recursive:true});
  const engine=JSON.parse(await readFile(path.join(root,'node_modules/tesseract.js/package.json'),'utf8'));
  const core=JSON.parse(await readFile(path.join(root,'node_modules/tesseract.js-core/package.json'),'utf8'));
  if(engine.version!=='7.0.0'||core.version!=='7.0.0')throw Error('The browser OCR protocol and assets require tesseract.js/core 7.0.0. Review the adapter before upgrading.');
  await copyFile(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),path.join(destination,'worker.min.js'));
  await copyFile(path.join(root,'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'),path.join(destination,'worker.min.js.LICENSE.txt'));
  await copyFile(path.join(root,'node_modules/tesseract.js/LICENSE.md'),path.join(destination,'tesseract.LICENSE.txt'));
  await copyFile(path.join(root,'node_modules/tesseract.js-core/LICENSE'),path.join(destination,'core.LICENSE.txt'));
  for(const variant of VARIANTS){
    const stem='tesseract-core-'+variant;
    // getCore selects *.wasm.js. Use the upstream non-inlined controller under
    // that name, paired with its separate WASM, to keep the Sites bundle small.
    // All 3 OEM1/LSTM variants are present; legacy OCR is never requested.
    await copyFile(path.join(root,'node_modules/tesseract.js-core',stem+'.js'),path.join(destination,stem+'.wasm.js'));
    await copyFile(path.join(root,'node_modules/tesseract.js-core',stem+'.wasm'),path.join(destination,stem+'.wasm'));
  }
  const models=[];
  for(const model of MODELS){
    const bytes=await pinnedModel(root,model);
    await writeFile(path.join(destination,model.language+'.traineddata.gz'),bytes);
    models.push({...model,source:`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${model.language}/4.0.0_best_int/${model.language}.traineddata.gz`});
  }
  await writeFile(path.join(destination,'assets.json'),JSON.stringify({engine:'tesseract.js',version:engine.version,coreVersion:core.version,oem:1,coreVariants:VARIANTS,models,license:'Apache-2.0'},null,2));
}
