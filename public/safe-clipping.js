// Quantize in grid/pixel space, not geographic degrees. This only affects geometry,
// never the diffusion values or NetCDF grid. Clipper preserves hole/island nesting.
(function(root){
  const C=root.ClipperLib, SCALE=1e6;
  function paths(multi){
    const result=[];
    for(const polygon of multi)for(let index=0;index<polygon.length;index++){
      const path=[];
      for(const [x,y] of polygon[index]){
        const p={X:Math.round(x*SCALE),Y:Math.round(y*SCALE)};
        if(!Number.isSafeInteger(p.X)||!Number.isSafeInteger(p.Y)||Math.abs(p.X)>1e14||Math.abs(p.Y)>1e14)throw new Error('切り抜き座標が計算範囲を超えています。');
        const last=path[path.length-1];if(!last||last.X!==p.X||last.Y!==p.Y)path.push(p);
      }
      if(path.length>1&&path[0].X===path.at(-1).X&&path[0].Y===path.at(-1).Y)path.pop();
      if(path.length<3||Math.abs(C.Clipper.Area(path))<.5)continue;
      if(C.Clipper.Orientation(path)!==(index===0))path.reverse();
      result.push(path);
    }
    return result;
  }
  function coordinates(node){
    const ring=node.Contour().map((p)=>[p.X/SCALE,p.Y/SCALE]);
    if(ring.length)ring.push([...ring[0]]);return ring;
  }
  function operate(subject,other,type){
    const a=paths(subject),b=paths(other);
    if(!a.length)return [];
    if(!b.length&&type===C.ClipType.ctIntersection)return [];
    const clipper=new C.Clipper(C.Clipper.ioStrictlySimple),tree=new C.PolyTree();
    clipper.AddPaths(a,C.PolyType.ptSubject,true);
    if(b.length)clipper.AddPaths(b,C.PolyType.ptClip,true);
    if(!clipper.Execute(type,tree,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero))throw new Error('海岸線の切り抜きに失敗しました。');
    const output=[];
    function visit(node){
      if(!node.IsHole()&&node.Contour().length)output.push([coordinates(node),...node.Childs().filter((child)=>child.IsHole()).map(coordinates)]);
      node.Childs().forEach(visit);
    }
    tree.Childs().forEach(visit);return output;
  }
  root.AquaClip={intersection:(a,b)=>operate(a,b,C.ClipType.ctIntersection),difference:(a,b)=>operate(a,b,C.ClipType.ctDifference)};
})(globalThis);
