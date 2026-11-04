import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { describe,expect,it } from 'vitest'
import { tempDir } from './helpers'

describe('isolated browser installer',()=>{
  it('runs the trusted download worker with message/exit semantics and refuses other fork targets',()=>{
    const dir=tempDir(),helper=path.join(dir,'installer.cjs'),cli=path.join(dir,'cli.cjs'),entry=path.join(dir,'lib','entry','oopBrowserDownload.js')
    fs.writeFileSync(helper,ts.transpileModule(fs.readFileSync(path.resolve('src/main/browser-installer.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)
    fs.mkdirSync(path.dirname(entry),{recursive:true})
    fs.writeFileSync(entry,"const {isMainThread}=require('node:worker_threads');process.on('message',message=>{process.send({reply:message.request,isMainThread});process.exit(0)})")
    fs.writeFileSync(path.join(dir,'lib','bootstrap.js'),'')
    fs.writeFileSync(path.join(dir,'lib','utilsBundle.js'),"exports.program={parseAsync(){return this.action()}}")
    const bundle=path.join(dir,'lib','coreBundle.js')
    fs.writeFileSync(bundle,"exports.libCliTestStub={decorateProgram(){}};exports.libCli={decorateProgram(program){program.action=()=>new Promise((resolve,reject)=>{const child=require('node:child_process').fork(require('node:path').join(__dirname,'entry/oopBrowserDownload.js'));child.on('message',message=>console.log(JSON.stringify(message)));child.on('exit',code=>code===0?resolve():reject(new Error('Worker failed')));child.on('error',reject);child.send({request:'synthetic-download'})})}}")
    const output=execFileSync(process.execPath,[helper,cli],{encoding:'utf8',timeout:5000,windowsHide:true})
    expect(JSON.parse(output)).toEqual({reply:'synthetic-download',isMainThread:false})
    fs.writeFileSync(bundle,"exports.libCliTestStub={decorateProgram(){}};exports.libCli={decorateProgram(program){program.action=async()=>require('node:child_process').fork('unapproved.js')}}")
    expect(()=>execFileSync(process.execPath,[helper,cli],{timeout:5000,windowsHide:true,stdio:'pipe'})).toThrow()
  })
})
