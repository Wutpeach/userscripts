'use strict';
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.DCD360_CDP || 'http://127.0.0.1:18800');
  const page = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().startsWith('https://www.dongchedi.com/auto/series/'));
  if (!page) throw new Error('没有当前懂车帝详情页');
  const session = await page.context().newCDPSession(page); const contexts = [];
  session.on('Runtime.executionContextCreated', (event) => contexts.push(event.context));
  await session.send('Runtime.enable');
  for (const context of contexts) {
    const result = await session.send('Runtime.evaluate', {
      contextId: context.id, returnByValue: true,
      expression: '(function(){try {var e=new MouseEvent("mousemove",{view:window,clientX:100});return {ok:true,x:e.clientX};}catch(e){return {ok:false,error:e.message};}})()',
    });
    if (!context.name.startsWith('__playwright')) {
      const motion = await session.send('Runtime.evaluate', {
        contextId: context.id, returnByValue: true, awaitPromise: true,
        expression: '(async function(){const root=document.querySelector(\'[class*="series-360-image_frame-wrapper"]\')?.parentElement;if(!root)return null;const cur=()=>[...root.children].findIndex(e=>getComputedStyle(e).opacity==="1")+1;const send=(t,x,b)=>{const e=new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:400,buttons:b,button:0});root.dispatchEvent(e);return {x:e.clientX,b:e.buttons,t:e.type};};const tick=()=>new Promise(r=>setTimeout(r,100));const start=cur();send("mouseover",1200,0);await tick();send("mousedown",1200,1);await tick();const event=send("mousemove",1208,1);await tick();const end=cur();send("mouseup",1208,0);await tick();return {start,end,event};})()',
      });
      console.log(JSON.stringify({ id: context.id, name: context.name, type: context.auxData?.type, result: result.result.value, motion: motion.result.value, exception: motion.exceptionDetails?.text }));
    }
  }
  const scripts = []; session.on('Debugger.scriptParsed', (event) => { if (/userscript|user\.js/i.test(event.url)) scripts.push({ id: event.scriptId, context: event.executionContextId, url: event.url }); });
  await session.send('Debugger.enable'); console.log(JSON.stringify({ userscripts: scripts }));
  await session.detach(); process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
