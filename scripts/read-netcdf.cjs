// Independent test reader for fixed-size CDF-1 variables used by this app.
module.exports = function readNetCDF(buffer) {
  if(buffer.subarray(0,4).toString('hex')!=='43444601')throw new Error('Not CDF-1');
  let pos=4;
  const integer=()=>{const value=buffer.readUInt32BE(pos);pos+=4;return value;};
  const string=()=>{const n=integer(),value=buffer.subarray(pos,pos+n).toString('utf8');pos+=(n+3)&~3;return value;};
  const attributes=()=>{
    const tag=integer(),count=integer(),result={};if(tag!==0&&tag!==12)throw new Error('Attribute tag');
    for(let i=0;i<count;i++){
      const name=string(),type=integer(),n=integer();
      if(type!==2&&type!==6)throw new Error('Unexpected attribute type');
      result[name]=type===2?buffer.subarray(pos,pos+n).toString('utf8'):buffer.readDoubleBE(pos);
      pos+=((type===2?n:n*8)+3)&~3;
    }return result;
  };
  if(integer()!==0||integer()!==10)throw new Error('Unexpected dimensions');
  const dimensions=Array.from({length:integer()},()=>({name:string(),size:integer()})),global=attributes();
  if(integer()!==11)throw new Error('Variable tag');
  const variables=Array.from({length:integer()},()=>{
    const name=string(),dims=Array.from({length:integer()},integer),attrs=attributes();
    if(integer()!==6)throw new Error('Variable type');
    const size=integer(),offset=integer();if(offset%4||offset+size>buffer.length)throw new Error('Invalid variable extent');
    return {name,dims,attrs,values:Array.from({length:size/8},(_,i)=>buffer.readDoubleBE(offset+i*8))};
  });return {dimensions,global,variables};
};
