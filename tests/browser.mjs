import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {browserApi} from './helpers/browser-api.mjs';

// Requires an isolated production build with the loopback API, never production keys.
const origin='http://127.0.0.1:3035';
const api=await browserApi(),results=[],errors=[];
await mkdir('test-results',{recursive:true});
await mkdir('test-results/browser-temp',{recursive:true});
process.env.TEMP=process.env.TMP=resolve('test-results/browser-temp');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3035','-H','127.0.0.1'],{env:{...process.env,FATIN_BUILD_DIR:process.env.FATIN_BUILD_DIR||'.next-test',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let serverLog='';server.stdout.on('data',s=>serverLog+=s);server.stderr.on('data',s=>serverLog+=s);
let browser,page,context;
async function waitServer(){for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)return;}catch{}if(server.exitCode!==null)throw new Error(serverLog);await new Promise(r=>setTimeout(r,200));}throw new Error('Next did not start: '+serverLog);}
async function fresh(path,session){
  if(context)await context.close();context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-SA',acceptDownloads:true});
  if(session)await context.addInitScript(s=>localStorage.setItem('sb-127-auth-token',JSON.stringify(s)),session);
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+path);return page;
}
const click=name=>page.getByRole('button',{name,exact:typeof name==='string'}).click();
async function visible(selector){await page.locator(selector).waitFor();}
async function noOverflow(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+page.url());}
async function save(name){await noOverflow();await page.screenshot({path:`test-results/${name}.png`,fullPage:true});}
async function run(name,fn){
  const start=Date.now(),before=errors.length;
  try{await fn();assert.deepEqual(errors.slice(before),[]);results.push({name,pass:true,ms:Date.now()-start});console.log('PASS '+name);}
  catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message.slice(0,700));if(page)await page.screenshot({path:`test-results/failure-${results.length}.png`,fullPage:true}).catch(()=>{});}
}
try{
  await waitServer();browser=await chromium.launch({...(process.env.FATIN_BROWSER?{channel:process.env.FATIN_BROWSER}:{}),headless:true});
  await run('responsive catalogue and all six entry pages',async()=>{
    await fresh('/');await visible('.games-grid');assert.equal(await page.locator('.game-card').count(),6);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});await save('home-'+width);}
    for(const path of ['/mafia','/crime','/wave','/wrong','/letters']){await page.goto(origin+path);await page.setViewportSize({width:320,height:844});await noOverflow();assert.equal(await page.locator('h1').count(),1);}
  });
  await run('outsider local: ordered private roles, reload, votes, scores, replay',async()=>{
    await fresh('/local');await click('وزّع الأدوار');
    const state=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('fatin-local-v1')));
    const count=(await state()).players.length;
    for(let i=0;i<count;i++){
      assert.equal(await page.locator('select').count(),0);assert.equal(await page.locator('.role-card').count(),0);
      await click(/اعرض دوري/);await visible('.role-card');
      if(i===0){await page.reload();await click(/اعرض دوري/);}
      await click(/حفظت دوري/);
    }
    await click('نبدأ التصويت');
    for(let i=0;i<count;i++){await click(/بأصوّت/);await page.locator('.vote-option').first().click();await click('تثبيت صوتي وإخفاؤه');}
    await click('اكشف النتيجة');await visible('.round-scores');await save('outsider-result');await click('جولة جديدة مع فطين');assert.equal((await state()).round,2);
  });
  await run('wrong local: hidden questions, simultaneous reveal, ordered vote, replay',async()=>{
    await fresh('/wrong/local');await click('وزّع الأسئلة سرًا');
    for(let i=0;i<4;i++){
      assert.equal(await page.locator('.wrong-answers').count(),0);assert.equal(await page.locator('select').count(),0);
      await click('افتح سؤالي');await visible('.wrong-private');
      if(i===0){await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.locator('.wrong-private').waitFor({state:'detached'});await click('افتح سؤالي');}
      await page.locator('.wrong-private input').fill(String(20+i));await click('ثبّت إجابتي وأخفِ الشاشة');
    }
    await visible('.common-question');assert.equal(await page.locator('.answer-grid article').count(),4);await click('خلصنا النقاش، افتح التصويت');
    for(let i=0;i<4;i++){await click('الجوال معي، أصوّت');await click('ثبّت صوتي');}
    await visible('.round-scores');await save('wrong-result');await click('وزّع الأسئلة سرًا');await visible('.party-cover');
  });
  await run('letters local: all letters, undo, complete and new prompt',async()=>{
    await fresh('/letters/local');await click('اعرض السؤال والحروف');assert.equal(await page.locator('.letter-tile').count(),28);
    await click('استخدم حرف ف');await click('تراجع عن آخر حرف');assert.equal(await page.locator('.letter-tile').count(),28);
    for(let i=0;i<28;i++)await page.locator('.letter-tile').first().click();await save('letters-complete');await click('سؤال جديد وحروف كاملة');assert.equal(await page.locator('.letter-tile').count(),28);
  });
  await run('mafia local: two passes, night privacy and contrast, final handoff, skips',async()=>{
    await fresh('/mafia/local');await click('وزّع الأدوار');
    for(let i=0;i<5;i++){await click('اعرف دوري فقط');assert.equal(await page.locator('.mafia-private select').count(),0);await click('عرفت دوري، أخفِ الشاشة ومرّر الجوال');}
    await click('ابدأ الدورة الثانية: قدرات الليل');await visible('.night-mode .mafia-cover');
    assert.equal(await page.locator('.mafia-pass select').count(),0);
    assert.ok((await page.locator('.mafia-cover').evaluate(e=>getComputedStyle(e).backgroundImage)).includes('32, 32, 50'));
    await save('mafia-night');
    for(let i=0;i<5;i++){
      await click('افتح قدرتي الليلية');const sleep=page.getByRole('button',{name:'أنا نائم، تأكيد',exact:true});
      if(await sleep.count())await sleep.click();else await click('تثبيت الاختيار');
      assert.equal(await page.locator('.night-mode').count(),1);await click('إخفاء وإنهاء دوري');
    }
    await page.locator('.night-mode').waitFor({state:'detached'});await click('افتح التصويت');
    for(let i=0;i<5;i++){await click('افتح تصويتي');await click('ثبّت صوتي وأخفِ الشاشة');}
    await visible('.night-mode');const g=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('fatin-mafia-local-v1')));assert.equal(g.log.at(-1).tally.skip,5);assert.equal(g.cycle,2);
  });
  await run('wave local: ordered hidden guesses and four complete turns',async()=>{
    await fresh('/wave/local');await page.getByRole('button',{name:'٤ موجات',exact:true}).count().then(async n=>{if(n)await click('٤ موجات');else await page.locator('select').selectOption('4');});await click('يلا نبدأ الموجة');
    for(let turn=1;turn<=4;turn++){
      await click('اكشف الهدف لي');await page.locator('.wave-private input').fill('قهوة ساخنة');await click('ثبّت التلميح وأخفِ الهدف');assert.equal(await page.locator('.wave-private').count(),0);
      for(let i=0;i<3-1;i++){await click('الجوال معي، أبدأ تخميني');await click('تثبيت تخميني');}
      await visible('.wave-result');if(turn<4)await click('موجة جديدة وصاحب تلميح جديد');
    }
    await save('wave-complete');assert.equal((await page.evaluate(()=>JSON.parse(sessionStorage.getItem('fatin-wave-local-v1')))).phase,'complete');
  });
  await run('crime local: private deal, weapon/evidence lock, public PNG download and replay',async()=>{
    await fresh('/crime/local');await click('وزّع ملفات القضية');
    for(let i=0;i<4;i++){
      await click(/افتح ملفي/);
      const choose=page.getByRole('button',{name:'ثبّت السلاح والدليل سرًا',exact:true});
      if(await choose.count()){await page.getByRole('button',{name:/^سلاح:/}).first().click();await page.getByRole('button',{name:/^دليل:/}).first().click();await choose.click();}
      await click('جاهز، أخفِ الملف وكمل');
    }
    await visible('.crime-gallery');await save('crime-cards');
    const download=page.waitForEvent('download');await click('تنزيل الصورة');const file=await download;await file.saveAs('test-results/crime-hand.png');const png=await readFile('test-results/crime-hand.png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1500);assert.equal(await page.locator('img[src^="blob:"]').count(),0);
    await click('أنا الراوي، افتح ملف القضية');await click('إغلاق القضية وإعلان فوز المجرم');await click('نعم، أغلق القضية');await click('قضية جديدة وبطاقات جديدة');await click(/افتح ملفي/);
  });
  await run('online guests create and join from separate browsers; refresh and reconnect',async()=>{
    await fresh('/');await click('نلعب برا السالفة');await click(/كل واحد بجواله/);await page.getByLabel('وش نناديك؟').fill('مضيف التجربة');await click('إنشاء الغرفة');await page.waitForURL('**/room/*');const code=page.url().split('/').at(-1);
    const other=await browser.newContext({viewport:{width:390,height:844}}),guest=await other.newPage();
    try{
      await guest.goto(origin+'/?join='+code);await guest.getByLabel('وش نناديك؟').fill('ضيف التجربة');await guest.getByRole('button',{name:'دخول الغرفة',exact:true}).click();await guest.waitForURL('**/room/*');await guest.getByText('مضيف التجربة',{exact:true}).first().waitFor();
      await page.getByText('ضيف التجربة',{exact:true}).first().waitFor({timeout:15000});await page.reload();await page.getByText('ضيف التجربة',{exact:true}).first().waitFor();
      await context.setOffline(true);await page.locator('.connection').filter({hasText:'الاتصال منقطع'}).waitFor();await context.setOffline(false);await page.locator('.connection').filter({hasText:/تحديث تلقائي|متصل بفطين/}).waitFor({timeout:15000});
      await save('online-lobby');
    }finally{await other.close();}
  });
  for(const [kind,count] of [['outsider',3],['crime',4],['mafia',5],['wave',3],['wrong',4],['letters',2]])await run('online '+kind+': isolated signed-in UI and private data boundaries',async()=>{
    const g=await api.h.group(kind,count);await g.act('start',kind==='crime'?{narrator:g.state.me}:kind==='mafia'?{config:{moderator:false,mafia:1,doctor:true,detective:true,reveal:false}}:kind==='wave'?{total:4}:{});
    let uid=g.users[0];if(kind==='wave')uid=g.byId.get(g.state.giver);
    const path=kind==='outsider'?'/room/':`/${kind}/room/`;await fresh(path+g.code,api.session(uid));
    if(kind==='wrong'){await click('افتح سؤالي');await visible('.wrong-private');assert.equal(await page.locator('.wrong-answers').count(),0);await page.reload();await click('افتح سؤالي');}
    else if(kind==='mafia'){await click('اعرف دوري فقط');await visible('.mafia-private');assert.equal(await page.locator('.mafia-secret-roster').count(),0);}
    else if(kind==='wave'){await click('اكشف الهدف لي');await visible('.wave-private');}
    else if(kind==='crime'){await click(/افتح ملفي/);}
    else if(kind==='letters'){await click('استخدم حرف ف');await page.getByRole('button',{name:'استخدم حرف ف',exact:true}).waitFor({state:'detached'});}
    else{await click('شوف دورك لحالك');await visible('.role-card');}
    await save('online-'+kind);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    for(const secret of ['.wrong-private','.mafia-private','.wave-private','.role-card'])assert.equal(await page.locator(secret).count(),0,'secret must be concealed on blur');
  });
}finally{
  if(browser)await browser.close();server.kill();await Promise.race([once(server,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);await api.close();
  await writeFile('test-results/browser-report.json',JSON.stringify({results,uncaughtErrors:errors},null,2));
}
console.log(`${results.filter(r=>r.pass).length}/${results.length} browser scenarios passed`);if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
