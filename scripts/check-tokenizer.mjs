import {readFileSync} from 'node:fs';
import {createTokenizer} from '../dist/embeddings.mjs';
const tokenizer=createTokenizer(JSON.parse(readFileSync(new URL('../dist/assets/tokenizer.json',import.meta.url),'utf8')));
const reference=JSON.parse(readFileSync(new URL('./tokenizer-reference.json',import.meta.url),'utf8'));
const results=reference.cases.map(({text,ids})=>({text,expected:ids,actual:tokenizer.encode(text)}));
const failed=results.filter(x=>JSON.stringify(x.expected)!==JSON.stringify(x.actual));
console.log(JSON.stringify({passed:results.length-failed.length,total:results.length,failed},null,2));
if(failed.length)process.exitCode=1;
