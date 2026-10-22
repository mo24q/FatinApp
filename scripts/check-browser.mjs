import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public-key',NEXT_TELEMETRY_DISABLED:'1',FATIN_BUILD_DIR:'.next-test-'+Date.now().toString(36)};
function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Test command exited ${code}`)));});}
// Keep the generated test-build paths out of the normal production setup.
const files=['next-env.d.ts','tsconfig.json'],originals=await Promise.all(files.map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
try{
  await run(['scripts/update-content.mjs']);
  await run(['node_modules/next/dist/bin/next','build','--webpack']);
  await run(['tests/browser.mjs']);
}finally{await Promise.all(files.map((f,i)=>writeFile(new URL('../'+f,import.meta.url),originals[i])));}
