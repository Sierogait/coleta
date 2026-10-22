"use strict";
// ---------------- SHA-256 incremental (arquivos grandes sem carregar tudo na memória)
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
class Sha256 {
  constructor(){ this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); this.buf=new Uint8Array(64); this.blen=0; this.total=0; this.w=new Uint32Array(64); }
  bloco(b, o){ const w=this.w, h=this.h;
    for(let i=0;i<16;i++) w[i]=(b[o+4*i]<<24)|(b[o+4*i+1]<<16)|(b[o+4*i+2]<<8)|b[o+4*i+3];
    for(let i=16;i<64;i++){ const a=w[i-15], c=w[i-2]; const s0=((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3); const s1=((c>>>17)|(c<<15))^((c>>>19)|(c<<13))^(c>>>10); w[i]=(w[i-16]+s0+w[i-7]+s1)|0; }
    let A=h[0],B=h[1],C=h[2],D=h[3],E=h[4],F=h[5],G=h[6],H=h[7];
    for(let i=0;i<64;i++){ const S1=((E>>>6)|(E<<26))^((E>>>11)|(E<<21))^((E>>>25)|(E<<7)); const ch=(E&F)^(~E&G); const t1=(H+S1+ch+K[i]+w[i])|0;
      const S0=((A>>>2)|(A<<30))^((A>>>13)|(A<<19))^((A>>>22)|(A<<10)); const mj=(A&B)^(A&C)^(B&C); const t2=(S0+mj)|0;
      H=G; G=F; F=E; E=(D+t1)|0; D=C; C=B; B=A; A=(t1+t2)|0; }
    h[0]=(h[0]+A)|0; h[1]=(h[1]+B)|0; h[2]=(h[2]+C)|0; h[3]=(h[3]+D)|0; h[4]=(h[4]+E)|0; h[5]=(h[5]+F)|0; h[6]=(h[6]+G)|0; h[7]=(h[7]+H)|0; }
  update(d){ let o=0; this.total+=d.length;
    if(this.blen){ const n=Math.min(64-this.blen, d.length); this.buf.set(d.subarray(0,n), this.blen); this.blen+=n; o=n; if(this.blen===64){ this.bloco(this.buf,0); this.blen=0; } }
    for(; o+64<=d.length; o+=64) this.bloco(d,o);
    if(o<d.length){ this.buf.set(d.subarray(o), 0); this.blen=d.length-o; } }
  digest(){ const bits=this.total*8; const pad=new Uint8Array(((this.blen<56)?56:120)-this.blen); pad[0]=0x80; this.update(pad);
    const l=new Uint8Array(8); const hi=Math.floor(bits/2**32), lo=bits>>>0; l[0]=hi>>>24;l[1]=hi>>>16;l[2]=hi>>>8;l[3]=hi;l[4]=lo>>>24;l[5]=lo>>>16;l[6]=lo>>>8;l[7]=lo; this.total-=pad.length; this.update(l);
    const out=new Uint8Array(32); for(let i=0;i<8;i++){ out[4*i]=this.h[i]>>>24; out[4*i+1]=this.h[i]>>>16; out[4*i+2]=this.h[i]>>>8; out[4*i+3]=this.h[i]; } return out; }
}
const hex = b => Array.from(b, x=>x.toString(16).padStart(2,'0')).join('');
async function hashArquivo(f, progresso){
  const s=new Sha256(); const T=4*1024*1024;
  for(let i=0;i<f.size;i+=T){ s.update(new Uint8Array(await f.slice(i,i+T).arrayBuffer())); progresso && progresso(Math.min(f.size,i+T)); }
  return hex(s.digest());
}
