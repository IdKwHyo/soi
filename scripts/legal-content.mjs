// Canonical EN/Thai copy. Review against docs/legal-data-audit.md whenever data flows change.
export const policyDate = {en:'15 October 2026',th:'15 ตุลาคม 2569'};
export const legalContent = {
 en: {
  privacy: {
   title:'Privacy Policy',intro:'How this Soi Studio preview handles your information.',
   note:'Preview notice. The operator’s legal name, privacy contact and production retention arrangements still need to be confirmed. Use sample or de-identified information while evaluating the prototype.',
   sections:[
    ['The preview and your information',[
     'Soi Studio is a restaurant merchant copilot prototype. Demo routes use simulated records and replies. Changes, demo orders, uploaded demo dish photos and workspace history can be saved in this browser until you reset them or clear this site’s browser data. Demo receipt reading uses sample fields; a selected filename may be saved with the sample record, but its receipt image is not uploaded or archived. A local workspace can also be used when the main app’s cloud connection is unavailable; its storage status is shown in the app.',
     'The cinematic sign-in page is a simulation. Its username and password values are not read, stored or submitted by the app. Real merchant sign-in uses the hosting platform’s ChatGPT sign-in and an account identifier to check access to a workspace.'
    ]],
    ['Connected merchant workspaces',[
     'When you use connected features, the app stores business settings, menu items, recipes, sales and campaign records, receipt text and amounts, confirmed memory, chat history and associated account/workspace identifiers. These records support the calculations, order queue, advice and history you request. Connected business-report imports also retain the original CSV in private compressed storage.',
     'Receipt OCR runs in your browser using locally hosted recognition files. Saving a receipt in the connected app can upload its original image, including embedded metadata, to private object storage, and save the reviewed text and fields in the database. Only submit documents you are authorised to use; remove unnecessary names, contact details and financial identifiers first.'
    ]],
    ['Menus and QR orders',[
     'A live QR order sends the table or collection label, selected dishes, quantities and any kitchen note to the merchant’s workspace. An account, customer name, email address and payment details are not required by this order flow. Avoid personal or sensitive information in free-text notes. Keep the private order-tracking link to yourself: anyone with that link can view that order’s details and status, including its items, total, table label and notes.',
     'Live available-menu details and attached dish photos are public; private recipe costs are not included in the public menu. Real dish photos are resized and re-encoded before upload; demo photos stay in browser storage. Generated sample food images are illustrative, not proof of an actual dish. The demo photo-to-menu flow previews your selected image and supplies a sample menu; it does not perform live AI image analysis.'
    ]],
    ['AI and external services',[
     'Demo advisor replies and ingredient intelligence are simulated. If Gemini is configured and permitted in the connected app, questions and uncached evidence documents, including business and receipt-derived context, may be sent to Google to create embeddings. Selected evidence and recent conversation history are then sent to generate a response. Merchant-data AI requires a separate server setting. The application has no custom model-training pipeline; a domain prompt and retrieval layer are not model training.',
     'This site uses ChatGPT Sites and Cloudflare hosting, database and object-storage infrastructure. Google is used only for enabled AI requests. Infrastructure providers may process network and security information when you visit. Their log retention, processing locations, contractual safeguards and AI data-use terms have not been verified for this preview; this notice does not promise a particular region or provider retention period.'
    ]],
    ['Browser storage and privacy choices',[
     'The app does not install analytics, advertising pixels or first-party tracking cookies. It uses browser storage for workspace/demo data and your language choice, a short-lived session flag for the sign-in animation, and a local record of your privacy choice that expires after 180 days. OCR language models may also be cached in IndexedDB; receipt images are not stored in that model cache. Hosting sign-in and security mechanisms are separate from the app’s own storage.',
     'No optional tracking is enabled. Privacy choices in the footer lets you keep optional services off. A future optional service must be disclosed and receive a separate affirmative choice before its loader can run. Closing the panel, browsing or signing in is not consent. These controls do not delete business records or stop service requests you explicitly make.'
    ],'choices'],
    ['Retention and deletion',[
     'Browser data remains until cleared or replaced; clearing this site’s browser data removes local copies, not records already saved in the cloud. Workspace reset and clearing a chat do not erase every immutable record, receipt archive, audit entry or cached response. There is currently no complete account-erasure workflow or automatic retention schedule for those records.',
     'AI response caches have a one-hour reuse window and embedding caches a seven-day window. Expired entries are cleaned up during later successful workspace saves; expiry is not a guarantee of immediate physical deletion. Export and reset features cover the workspace data described by those controls, not a complete privacy-rights request.'
    ]],
    ['Your rights and contact',[
     'Depending on the law that applies, you may have rights to access, correct, erase or receive your personal data, restrict or object to its use, withdraw consent, and complain to a data-protection authority. For this preview, contact the person or merchant who provided your link. Do not send sensitive information through a public issue or comment.',
     'Before operational use with personal data, the operator must publish its identity and a verified privacy contact, document the applicable purposes and legal bases, and establish request handling, retention and transfer safeguards. This preview notice is not a certification of compliance with Thailand’s PDPA, GDPR or the EU AI Act.'
    ]]
   ]
  },
  terms:{
   title:'Terms of Service',intro:'A few clear terms for exploring Soi Studio.',
   note:'Prototype terms for evaluation. Operator identity, contact and any commercial agreement remain to be finalised before a production launch.',
   sections:[
    ['Using the prototype',[
     'Soi Studio helps merchants explore receipt costs, recipes, menus, order queues and business decisions. You may evaluate the preview using information you are authorised to provide. Protect merchant access and order-tracking links, respect other people’s information and image rights, and do not probe or access another workspace without permission.'
    ]],
    ['Demo and connected modes',[
     'Demo records, sales, AI replies, ingredient intelligence and photo-to-menu suggestions are simulations. They are not evidence of real sales, a trained ingredient model, customer acquisition or business results. The simulated sign-in does not create an account. Connected features depend on authentication, configured providers and available services; an integration-ready interface does not mean a platform is connected.'
    ]],
    ['Merchant decisions stay with you',[
     'Review receipt dates, quantities, units, prices and recipe portions before using a calculation. Margins depend on the costs and fees actually included; they are not a guarantee of net profit. AI advice, forecasts and cooking-time estimates can be wrong. Recommendations do not automatically purchase stock, change prices or launch campaigns.',
     'Storage or expiry illustrations do not determine whether food is safe. Confirm storage conditions, supplier labels and applicable food-safety guidance independently. The app is not professional legal, financial, medical or food-safety advice.'
    ]],
    ['Orders and payments',[
     'QR ordering organises requests and kitchen status. It does not process checkout, collect payment or prove that an order was paid. The merchant remains responsible for availability, fulfilment, allergens, payment arrangements and any government-aid eligibility. Resolve order changes, refunds and payment questions directly with the merchant. Estimated preparation times may change.'
    ]],
    ['Content and service availability',[
     'You retain your rights in the material you provide. Submit only material the app and merchant may lawfully process and display as described in the Privacy Policy. Public menu photos are visible to customers; generated examples may differ from the food served.',
     'The preview may change, become unavailable or lose data. Keep independent copies of important records. No subscription is charged or payment collected by this preview; any later paid service will require separate pricing and terms. No business outcome or uninterrupted service is promised. Nothing here excludes rights or responsibilities that applicable law does not allow to be excluded.'
    ]],
    ['Questions and updates',[
     'Contact the person or merchant who shared your preview link. Read the Privacy Policy for current data handling and its limitations. Material changes should be reflected in the dated terms and notice before new processing begins; optional-service consent remains separate. A verified operator contact and production agreement are still required before a commercial launch.'
    ]]
   ]
  }
 },
 th:{
  privacy:{
   title:'นโยบายความเป็นส่วนตัว',intro:'ข้อมูลของคุณถูกใช้และจัดเก็บอย่างไรใน Soi Studio รุ่นทดลอง',
   note:'ประกาศสำหรับรุ่นทดลอง ยังต้องยืนยันชื่อผู้ดำเนินการตามกฎหมาย ช่องทางติดต่อด้านความเป็นส่วนตัว และแนวทางเก็บรักษาข้อมูลก่อนใช้งานจริง กรุณาใช้ข้อมูลตัวอย่างหรือข้อมูลที่ไม่ระบุตัวบุคคลในการทดลอง',
   sections:[
    ['รุ่นทดลองและข้อมูลของคุณ',[
     'Soi Studio เป็นต้นแบบผู้ช่วยสำหรับร้านอาหาร หน้าเดโมใช้ข้อมูลและคำตอบจำลอง การแก้ไข ออเดอร์เดโม รูปอาหารที่อัปโหลดในเดโม และประวัติพื้นที่ทำงานอาจถูกบันทึกในเบราว์เซอร์นี้จนกว่าจะรีเซ็ตหรือล้างข้อมูลเว็บไซต์ การอ่านใบเสร็จในเดโมใช้รายการตัวอย่าง ชื่อไฟล์ที่เลือกอาจถูกบันทึกกับรายการตัวอย่าง แต่รูปใบเสร็จไม่ได้ถูกอัปโหลดหรือจัดเก็บเป็นไฟล์ต้นฉบับ แอปหลักอาจใช้พื้นที่ทำงานในเบราว์เซอร์เมื่อเชื่อมต่อคลาวด์ไม่ได้ โดยแสดงสถานะการจัดเก็บไว้ในแอป',
     'หน้าเข้าสู่ระบบที่มีภาพภูเขาเป็นการจำลอง แอปไม่อ่าน บันทึก หรือส่งค่าชื่อผู้ใช้และรหัสผ่านในหน้านั้น การเข้าสู่ระบบร้านค้าจริงใช้ระบบ ChatGPT ของแพลตฟอร์มที่โฮสต์เว็บไซต์ และใช้รหัสบัญชีเพื่อตรวจสิทธิ์เข้าถึงพื้นที่ทำงาน'
    ]],
    ['พื้นที่ทำงานร้านค้าที่เชื่อมต่อจริง',[
     'เมื่อใช้ฟังก์ชันที่เชื่อมต่อจริง แอปจัดเก็บการตั้งค่าร้าน เมนู สูตรอาหาร ยอดขายและแคมเปญ ข้อความและยอดเงินจากใบเสร็จ ความจำที่ยืนยันแล้ว ประวัติสนทนา และรหัสบัญชีหรือพื้นที่ทำงาน เพื่อคำนวณ จัดคิวออเดอร์ ให้คำแนะนำ และแสดงประวัติตามที่คุณใช้งาน การนำเข้ารายงานธุรกิจในโหมดเชื่อมต่อยังเก็บไฟล์ CSV ต้นฉบับในพื้นที่ส่วนตัวแบบบีบอัด',
     'OCR อ่านใบเสร็จในเบราว์เซอร์ โดยใช้ไฟล์สำหรับรู้จำข้อความที่โฮสต์บนเว็บไซต์นี้ การบันทึกใบเสร็จในโหมดเชื่อมต่ออาจอัปโหลดภาพต้นฉบับรวมถึงข้อมูลกำกับภาพไปยังพื้นที่เก็บไฟล์ส่วนตัว และบันทึกข้อความกับรายการที่ตรวจแล้วลงฐานข้อมูล ส่งเฉพาะเอกสารที่คุณมีสิทธิ์ใช้ และลบชื่อ ช่องทางติดต่อ หรือเลขอ้างอิงทางการเงินที่ไม่จำเป็นก่อน'
    ]],
    ['เมนูและออเดอร์ผ่าน QR',[
     'ออเดอร์ QR จริงส่งป้ายโต๊ะหรือจุดรับอาหาร รายการอาหาร จำนวน และหมายเหตุถึงครัวไปยังพื้นที่ทำงานของร้าน ขั้นตอนนี้ไม่บังคับให้มีบัญชี ชื่อลูกค้า อีเมล หรือข้อมูลชำระเงิน หลีกเลี่ยงข้อมูลส่วนบุคคลหรือข้อมูลอ่อนไหวในหมายเหตุ เก็บลิงก์ติดตามออเดอร์ไว้เป็นส่วนตัว เพราะผู้ที่มีลิงก์สามารถดูรายละเอียดและสถานะออเดอร์ รวมถึงรายการอาหาร ยอดรวม ป้ายโต๊ะ และหมายเหตุได้',
     'ข้อมูลเมนูจริงที่เปิดขายและรูปอาหารที่ผูกไว้จะแสดงต่อสาธารณะ โดยไม่รวมต้นทุนสูตรอาหารส่วนตัว รูปอาหารจริงจะถูกย่อและเข้ารหัสภาพใหม่ก่อนอัปโหลด ส่วนรูปในเดโมเก็บในเบราว์เซอร์ ภาพอาหารตัวอย่างที่สร้างด้วย AI เป็นภาพประกอบ ไม่ใช่หลักฐานของอาหารจริง ฟังก์ชันภาพถ่ายเป็นเมนูในเดโมแสดงตัวอย่างภาพที่เลือกและเติมเมนูตัวอย่าง โดยไม่ได้วิเคราะห์ภาพด้วย AI จริง'
    ]],
    ['AI และบริการภายนอก',[
     'คำตอบที่ปรึกษาและระบบวิเคราะห์วัตถุดิบในเดโมเป็นการจำลอง หากตั้งค่าและอนุญาต Gemini ในแอปที่เชื่อมต่อจริง คำถามและเอกสารหลักฐานที่ยังไม่มีแคช รวมถึงบริบทร้านและข้อมูลจากใบเสร็จ อาจถูกส่งให้ Google เพื่อสร้างเวกเตอร์ค้นหา จากนั้นหลักฐานที่เลือกและประวัติสนทนาล่าสุดจะถูกส่งไปสร้างคำตอบ การใช้ AI กับข้อมูลร้านต้องเปิดค่าฝั่งเซิร์ฟเวอร์แยกต่างหาก แอปยังไม่มีระบบฝึกโมเดลเฉพาะ การเพิ่มคำสั่งเฉพาะด้านและข้อมูลค้นคืนไม่ใช่การฝึกโมเดล',
     'เว็บไซต์นี้ใช้โครงสร้างพื้นฐานของ ChatGPT Sites และ Cloudflare สำหรับโฮสต์ ฐานข้อมูล และไฟล์ Google ใช้เฉพาะคำขอ AI ที่เปิดใช้งาน ผู้ให้บริการโครงสร้างพื้นฐานอาจประมวลผลข้อมูลเครือข่ายและความปลอดภัยเมื่อคุณเข้าชม รุ่นทดลองยังไม่ได้ยืนยันระยะเวลาเก็บบันทึก ตำแหน่งประมวลผล มาตรการตามสัญญา และเงื่อนไขใช้ข้อมูลของผู้ให้บริการ AI จึงไม่รับรองประเทศจัดเก็บหรือระยะเวลาเก็บข้อมูลของผู้ให้บริการ'
    ]],
    ['ข้อมูลในเบราว์เซอร์และตัวเลือกความเป็นส่วนตัว',[
     'แอปไม่ได้ติดตั้งระบบวิเคราะห์ผู้เข้าชม พิกเซลโฆษณา หรือคุกกี้ติดตามของแอปเอง แอปใช้พื้นที่เก็บข้อมูลในเบราว์เซอร์สำหรับพื้นที่ทำงาน ข้อมูลเดโม ภาษาที่เลือก ค่าชั่วคราวในเซสชันสำหรับแอนิเมชันเข้าสู่ระบบ และบันทึกตัวเลือกความเป็นส่วนตัวที่หมดอายุหลัง 180 วัน ไฟล์โมเดลภาษา OCR อาจถูกแคชใน IndexedDB โดยแคชโมเดลนี้ไม่ได้เก็บรูปใบเสร็จ กลไกเข้าสู่ระบบและความปลอดภัยของผู้ให้บริการโฮสต์แยกจากการจัดเก็บของแอป',
     'ไม่มีการเปิดใช้งานการติดตามเสริม คุณสามารถใช้ “ตัวเลือกความเป็นส่วนตัว” ที่ท้ายหน้าเพื่อคงสถานะปิดบริการเสริม หากเพิ่มบริการเสริมในอนาคต ต้องแจ้งรายละเอียดและได้รับการยินยอมแยกอย่างชัดเจนก่อนโหลด การปิดหน้าต่าง การท่องเว็บ หรือการเข้าสู่ระบบไม่ถือเป็นความยินยอม ตัวเลือกนี้ไม่ลบข้อมูลธุรกิจและไม่หยุดคำขอบริการที่คุณสั่งใช้งานเอง'
    ],'choices'],
    ['การเก็บรักษาและการลบ',[
     'ข้อมูลในเบราว์เซอร์คงอยู่จนกว่าจะถูกล้างหรือแทนที่ การล้างข้อมูลเว็บไซต์ลบเฉพาะสำเนาในเครื่อง ไม่ลบข้อมูลที่ส่งขึ้นคลาวด์แล้ว การรีเซ็ตพื้นที่ทำงานหรือล้างแชตไม่ได้ลบประวัติถาวร ภาพใบเสร็จ บันทึกตรวจสอบ หรือคำตอบแคชทั้งหมด ปัจจุบันยังไม่มีขั้นตอนลบบัญชีและข้อมูลที่เกี่ยวข้องอย่างครบถ้วน หรือกำหนดเวลาลบข้อมูลเหล่านั้นอัตโนมัติ',
     'แคชคำตอบ AI ใช้ซ้ำได้หนึ่งชั่วโมง และแคชเวกเตอร์ค้นหาใช้ได้เจ็ดวัน รายการหมดอายุจะถูกล้างเมื่อมีการบันทึกพื้นที่ทำงานสำเร็จในภายหลัง การหมดอายุจึงไม่รับรองว่าข้อมูลถูกลบทันที ฟังก์ชันส่งออกและรีเซ็ตครอบคลุมข้อมูลตามที่ระบุในแต่ละฟังก์ชัน ไม่ใช่ขั้นตอนใช้สิทธิด้านข้อมูลส่วนบุคคลที่ครบถ้วน'
    ]],
    ['สิทธิและช่องทางติดต่อ',[
     'ตามกฎหมายที่ใช้บังคับ คุณอาจมีสิทธิขอเข้าถึง แก้ไข ลบ หรือรับข้อมูลส่วนบุคคล จำกัดหรือคัดค้านการใช้ ถอนความยินยอม และร้องเรียนต่อหน่วยงานคุ้มครองข้อมูล สำหรับรุ่นทดลอง กรุณาติดต่อบุคคลหรือร้านค้าที่ส่งลิงก์ให้คุณ อย่าส่งข้อมูลอ่อนไหวผ่านความคิดเห็นหรือประเด็นแจ้งปัญหาที่เปิดเผยต่อสาธารณะ',
     'ก่อนใช้งานกับข้อมูลส่วนบุคคลในการดำเนินงานจริง ผู้ดำเนินการต้องเผยแพร่ตัวตนและช่องทางติดต่อที่ยืนยันแล้ว ระบุวัตถุประสงค์และฐานกฎหมาย รวมทั้งจัดให้มีขั้นตอนรับคำขอ ระยะเวลาเก็บรักษา และมาตรการโอนข้อมูล ประกาศรุ่นทดลองนี้ไม่ใช่การรับรองว่าปฏิบัติตาม PDPA, GDPR หรือ EU AI Act ครบถ้วน'
    ]]
   ]
  },
  terms:{
   title:'ข้อกำหนดการใช้บริการ',intro:'ข้อกำหนดสั้น ๆ สำหรับทดลองใช้งาน Soi Studio',
   note:'ข้อกำหนดสำหรับประเมินต้นแบบ ยังต้องระบุตัวผู้ดำเนินการ ช่องทางติดต่อ และข้อตกลงเชิงพาณิชย์ก่อนเปิดใช้งานจริง',
   sections:[
    ['การใช้งานต้นแบบ',[
     'Soi Studio ช่วยร้านค้าทดลองวิเคราะห์ต้นทุนจากใบเสร็จ สูตรอาหาร เมนู คิวออเดอร์ และการตัดสินใจทางธุรกิจ คุณสามารถทดลองด้วยข้อมูลที่มีสิทธิ์นำมาใช้ โปรดรักษาสิทธิ์เข้าถึงร้านและลิงก์ติดตามออเดอร์ เคารพข้อมูลและสิทธิ์ในภาพของผู้อื่น และไม่ทดสอบเจาะระบบหรือเข้าถึงพื้นที่ทำงานของผู้อื่นโดยไม่ได้รับอนุญาต'
    ]],
    ['โหมดเดโมและโหมดเชื่อมต่อ',[
     'ข้อมูล ยอดขาย คำตอบ AI ระบบวัตถุดิบ และข้อเสนอเมนูจากภาพในเดโมเป็นการจำลอง ไม่ใช่หลักฐานยอดขายจริง โมเดลวัตถุดิบที่ผ่านการฝึก การได้ลูกค้าใหม่ หรือผลลัพธ์ทางธุรกิจ การเข้าสู่ระบบจำลองไม่สร้างบัญชี ฟังก์ชันเชื่อมต่อจริงขึ้นอยู่กับการยืนยันตัวตน การตั้งค่าผู้ให้บริการ และความพร้อมของระบบ หน้าจอที่รองรับการเชื่อมต่อไม่ได้หมายความว่าเชื่อมกับแพลตฟอร์มนั้นแล้ว'
    ]],
    ['ร้านค้าเป็นผู้ตัดสินใจ',[
     'ตรวจวันที่ จำนวน หน่วย ราคา และปริมาณวัตถุดิบต่อจานก่อนใช้ผลคำนวณ อัตรากำไรขึ้นอยู่กับต้นทุนและค่าธรรมเนียมที่นำมาคิด ไม่ใช่การรับรองกำไรสุทธิ คำแนะนำ AI การคาดการณ์ และเวลาปรุงโดยประมาณอาจผิดพลาด คำแนะนำไม่สั่งซื้อวัตถุดิบ เปลี่ยนราคา หรือเปิดแคมเปญให้โดยอัตโนมัติ',
     'ตัวอย่างระยะเวลาเก็บหรือวันหมดอายุไม่ได้ยืนยันว่าอาหารปลอดภัย โปรดตรวจสภาพการจัดเก็บ ฉลากผู้ขาย และแนวทางความปลอดภัยอาหารที่เกี่ยวข้องด้วยตนเอง แอปไม่ใช่คำแนะนำจากผู้ประกอบวิชาชีพด้านกฎหมาย การเงิน การแพทย์ หรือความปลอดภัยอาหาร'
    ]],
    ['ออเดอร์และการชำระเงิน',[
     'ระบบ QR จัดรายการสั่งอาหารและสถานะในครัว ไม่ดำเนินการเช็กเอาต์ รับชำระเงิน หรือยืนยันว่าออเดอร์จ่ายแล้ว ร้านค้ารับผิดชอบความพร้อมขาย การส่งมอบ สารก่อภูมิแพ้ วิธีชำระเงิน และคุณสมบัติตามโครงการช่วยเหลือของรัฐ โปรดติดต่อร้านโดยตรงเพื่อเปลี่ยนออเดอร์ ขอคืนเงิน หรือสอบถามการชำระเงิน เวลาปรุงโดยประมาณอาจเปลี่ยนแปลงได้'
    ]],
    ['เนื้อหาและความพร้อมให้บริการ',[
     'คุณยังคงมีสิทธิ์ในเนื้อหาที่ส่งมา ส่งเฉพาะเนื้อหาที่แอปและร้านค้าสามารถประมวลผลและแสดงได้โดยชอบตามนโยบายความเป็นส่วนตัว ลูกค้าสามารถเห็นรูปเมนูที่เปิดเผยต่อสาธารณะ ภาพตัวอย่างที่สร้างขึ้นอาจแตกต่างจากอาหารที่เสิร์ฟจริง',
     'รุ่นทดลองอาจเปลี่ยนแปลง หยุดให้บริการ หรือสูญเสียข้อมูล โปรดเก็บสำเนาข้อมูลสำคัญแยกไว้ รุ่นทดลองนี้ไม่เก็บค่าสมาชิกหรือรับชำระเงิน บริการแบบเสียเงินในอนาคตต้องมีราคาและข้อกำหนดแยกต่างหาก ไม่รับรองผลลัพธ์ทางธุรกิจหรือการให้บริการอย่างต่อเนื่อง ข้อความนี้ไม่ตัดสิทธิหรือความรับผิดที่กฎหมายไม่อนุญาตให้ยกเว้น'
    ]],
    ['คำถามและการปรับปรุง',[
     'ติดต่อบุคคลหรือร้านค้าที่ส่งลิงก์ทดลองให้คุณ อ่านนโยบายความเป็นส่วนตัวเพื่อทราบการจัดการข้อมูลและข้อจำกัดปัจจุบัน การเปลี่ยนแปลงสำคัญควรปรากฏในข้อกำหนดและประกาศที่ระบุวันที่ก่อนเริ่มประมวลผลแบบใหม่ ความยินยอมสำหรับบริการเสริมแยกจากข้อกำหนดนี้ ยังต้องมีช่องทางติดต่อผู้ดำเนินการที่ยืนยันแล้วและข้อตกลงสำหรับใช้งานจริงก่อนเปิดบริการเชิงพาณิชย์'
    ]]
   ]
  }
 }
};
