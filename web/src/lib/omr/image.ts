import { MARKER_CENTERS, SHEET, bubbleLayout } from "./layout";
import { homography, project, type Point } from "./homography";
import type { AnswerLetter, QuestionRead } from "@/lib/types/domain";

export const OMR_VERSION="1.3.0";
export interface OmrOutput { reads:QuestionRead[]; markerPoints:Point[]; H:number[]; debug:{threshold:number;markerMethod?:string;sheetMethod?:string} }
interface Rect { x0:number;y0:number;x1:number;y1:number }

function grayAt(data:Uint8ClampedArray,w:number,h:number,x:number,y:number){const ix=Math.max(0,Math.min(w-1,Math.round(x))),iy=Math.max(0,Math.min(h-1,Math.round(y)));const i=(iy*w+ix)*4;return .299*data[i]+.587*data[i+1]+.114*data[i+2]}
function rectW(r:Rect){return Math.max(1,r.x1-r.x0)}
function rectH(r:Rect){return Math.max(1,r.y1-r.y0)}
function fullRect(w:number,h:number):Rect{return{x0:0,y0:0,x1:w,y1:h}}
function expandRect(r:Rect,p:number,w:number,h:number):Rect{const dx=rectW(r)*p,dy=rectH(r)*p;return{x0:Math.max(0,r.x0-dx),y0:Math.max(0,r.y0-dy),x1:Math.min(w,r.x1+dx),y1:Math.min(h,r.y1+dy)}}

function markerComponent(data:Uint8ClampedArray,w:number,h:number,x0:number,y0:number,x1:number,y1:number,corner:number):Point|null{
  const sx=Math.max(0,Math.floor(x0)),sy=Math.max(0,Math.floor(y0)),ex=Math.min(w,Math.ceil(x1)),ey=Math.min(h,Math.ceil(y1)),rw=ex-sx,rh=ey-sy;
  if(rw<8||rh<8)return null;
  let min=255,max=0;
  for(let y=sy;y<ey;y+=3)for(let x=sx;x<ex;x+=3){const g=grayAt(data,w,h,x,y);min=Math.min(min,g);max=Math.max(max,g)}
  const t=Math.min(145,min+(max-min)*.38),bin=new Uint8Array(rw*rh),seen=new Uint8Array(rw*rh);
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)if(grayAt(data,w,h,sx+x,sy+y)<t)bin[y*rw+x]=1;
  const target=corner===0?{x:0,y:0}:corner===1?{x:rw,y:0}:corner===2?{x:rw,y:rh}:{x:0,y:rh};
  let best:{score:number,x:number,y:number}|null=null;
  const stack:number[]=[];
  for(let yy=0;yy<rh;yy++)for(let xx=0;xx<rw;xx++){
    const seed=yy*rw+xx;if(!bin[seed]||seen[seed])continue;
    seen[seed]=1;stack.push(seed);
    let area=0,sumx=0,sumy=0,minx=xx,maxx=xx,miny=yy,maxy=yy;
    while(stack.length){
      const idx=stack.pop()!,y=Math.floor(idx/rw),x=idx-y*rw;area++;sumx+=x;sumy+=y;minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
      if(x>0){const n=idx-1;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}
      if(x<rw-1){const n=idx+1;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}
      if(y>0){const n=idx-rw;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}
      if(y<rh-1){const n=idx+rw;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}
    }
    if(area<Math.max(24,rw*rh*.00045))continue;
    const bw=maxx-minx+1,bh=maxy-miny+1,aspect=Math.min(bw,bh)/Math.max(bw,bh),fill=area/(bw*bh),regionFill=area/(rw*rh),maxSide=Math.min(rw,rh)*.38;
    if(aspect<.55||fill<.42||regionFill>.11||bw>maxSide||bh>maxSide)continue;
    const cx=sumx/area,cy=sumy/area,dist=Math.hypot(cx-target.x,cy-target.y)/Math.hypot(rw,rh),size=Math.sqrt(area)/Math.min(rw,rh),score=size*2.25+fill+aspect-dist*1.15;
    if(!best||score>best.score)best={score,x:sx+cx,y:sy+cy};
  }
  return best?{x:best.x,y:best.y}:null;
}

function estimateSheetRect(img:ImageData):{rect:Rect;method:string}{
  const{width:w,height:h,data}=img;
  const frame=fullRect(w,h),ratio=w/h,a4=SHEET.width/SHEET.height;
  if(Math.abs(ratio-a4)<.105)return{rect:frame,method:"frame-a4"};
  const maxDim=340,s=Math.min(1,maxDim/Math.max(w,h)),dw=Math.max(70,Math.round(w*s)),dh=Math.max(70,Math.round(h*s));
  const g=new Uint8Array(dw*dh),hist=new Uint32Array(256);
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const v=Math.round(grayAt(data,w,h,(x+.5)/s-.5,(y+.5)/s-.5));g[y*dw+x]=v;hist[v]++}
  const total=dw*dh;
  function pct(q:number){let acc=0,target=total*q;for(let i=0;i<256;i++){acc+=hist[i];if(acc>=target)return i}return 255}
  const p20=pct(.20),p80=pct(.80),threshold=Math.max(125,Math.min(232,p20+(p80-p20)*.56));
  const bin=new Uint8Array(total),seen=new Uint8Array(total);for(let i=0;i<total;i++)if(g[i]>=threshold)bin[i]=1;
  const stack:number[]=[];let best:{score:number;minx:number;maxx:number;miny:number;maxy:number}|null=null;
  for(let seed=0;seed<total;seed++){
    if(!bin[seed]||seen[seed])continue;seen[seed]=1;stack.push(seed);
    let area=0,minx=dw,maxx=0,miny=dh,maxy=0;
    while(stack.length){const idx=stack.pop()!,yy=Math.floor(idx/dw),xx=idx-yy*dw;area++;minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,yy);maxy=Math.max(maxy,yy);if(xx>0){const n=idx-1;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}if(xx<dw-1){const n=idx+1;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}if(yy>0){const n=idx-dw;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}if(yy<dh-1){const n=idx+dw;if(bin[n]&&!seen[n]){seen[n]=1;stack.push(n)}}}
    const bw=maxx-minx+1,bh=maxy-miny+1,bbox=bw*bh;if(bbox<total*.10||area<total*.07)continue;
    const cx=(minx+maxx)/2,cy=(miny+maxy)/2,center=1-Math.min(1,Math.hypot(cx-dw/2,cy-dh/2)/Math.hypot(dw/2,dh/2));
    const aspect=bw/bh,aspectScore=Math.max(0,1-Math.abs(Math.log(Math.max(.01,aspect/a4)))/.8),fill=area/bbox,areaFrac=bbox/total;
    const score=areaFrac*2.5+center*1.3+aspectScore*1.15+fill*.4;
    if(!best||score>best.score)best={score,minx,maxx,miny,maxy};
  }
  if(!best)return{rect:frame,method:"frame-fallback"};
  const r:Rect={x0:best.minx/s,y0:best.miny/s,x1:(best.maxx+1)/s,y1:(best.maxy+1)/s};
  const expanded=expandRect(r,.035,w,h),coverage=rectW(expanded)*rectH(expanded)/(w*h);
  if(coverage>.93)return{rect:frame,method:"frame-bright"};
  return{rect:expanded,method:"bright-sheet"};
}

function componentCorners(img:ImageData,rect:Rect):Array<Point|null>{
  const{width:w,height:h,data}=img,sw=rectW(rect),sh=rectH(rect),pts:Array<Point|null>=[null,null,null,null];
  const scales:[[number,number],[number,number],[number,number],[number,number]]=[[.17,.14],[.23,.19],[.31,.26],[.40,.34]];
  for(const[fx,fy]of scales){
    const rx=sw*fx,ry=sh*fy,regions=[[rect.x0,rect.y0,rect.x0+rx,rect.y0+ry],[rect.x1-rx,rect.y0,rect.x1,rect.y0+ry],[rect.x1-rx,rect.y1-ry,rect.x1,rect.y1],[rect.x0,rect.y1-ry,rect.x0+rx,rect.y1]];
    for(let i=0;i<4;i++)if(!pts[i]){const r=regions[i];pts[i]=markerComponent(data,w,h,r[0],r[1],r[2],r[3],i)}
    if(pts.every(Boolean))break;
  }
  return pts;
}

function contrastMarkerCandidates(img:ImageData,rect:Rect):Array<Point|null>{
  const{width:w,height:h,data}=img,maxDim=480,s=Math.min(1,maxDim/Math.max(w,h)),dw=Math.max(80,Math.round(w*s)),dh=Math.max(80,Math.round(h*s));
  const small=new Float32Array(dw*dh);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++)small[y*dw+x]=grayAt(data,w,h,(x+.5)/s-.5,(y+.5)/s-.5);
  const stride=dw+1,integ=new Float64Array((dw+1)*(dh+1));for(let y=0;y<dh;y++){let row=0;for(let x=0;x<dw;x++){row+=small[y*dw+x];integ[(y+1)*stride+x+1]=integ[y*stride+x+1]+row}}
  function mean(x0:number,y0:number,x1:number,y1:number){x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(dw,Math.ceil(x1));y1=Math.min(dh,Math.ceil(y1));if(x1<=x0||y1<=y0)return 255;const sum=integ[y1*stride+x1]-integ[y0*stride+x1]-integ[y1*stride+x0]+integ[y0*stride+x0];return sum/((x1-x0)*(y1-y0))}
  const sr={x0:rect.x0*s,y0:rect.y0*s,x1:rect.x1*s,y1:rect.y1*s},rw=rectW(sr),rh=rectH(sr);
  const bounds=[[0,.38,0,.30],[.62,1,0,.30],[.62,1,.70,1],[0,.38,.70,1]],targets=[[sr.x0,sr.y0],[sr.x1,sr.y0],[sr.x1,sr.y1],[sr.x0,sr.y1]];
  const out:Array<Point|null>=[];const minSide=Math.min(rw,rh),sMin=Math.max(5,Math.floor(minSide*.018)),sMax=Math.max(sMin+2,Math.floor(minSide*.078));
  for(let corner=0;corner<4;corner++){
    const b=bounds[corner],x0=Math.floor(sr.x0+rw*b[0]),x1=Math.ceil(sr.x0+rw*b[1]),y0=Math.floor(sr.y0+rh*b[2]),y1=Math.ceil(sr.y0+rh*b[3]),target=targets[corner];let best:{score:number;cx:number;cy:number}|null=null;
    for(let side=sMin;side<=sMax;side+=2){const ring=Math.max(3,Math.round(side*.45)),outerArea=(side+2*ring)*(side+2*ring),innerArea=side*side,ringArea=outerArea-innerArea;for(let y=y0+ring;y+side+ring<y1;y+=2)for(let x=x0+ring;x+side+ring<x1;x+=2){const inner=mean(x,y,x+side,y+side),outer=mean(x-ring,y-ring,x+side+ring,y+side+ring),ringMean=(outer*outerArea-inner*innerArea)/Math.max(1,ringArea),contrast=ringMean-inner,cx=x+side/2,cy=y+side/2,dist=Math.hypot(cx-target[0],cy-target[1])/Math.hypot(rw,rh),score=contrast*1.2+(180-inner)*.5-dist*25;if((!best||score>best.score)&&inner<150&&contrast>22)best={score,cx,cy}}}
    out.push(best?{x:best.cx/s,y:best.cy/s}:null);
  }
  return out;
}

function validMarkerGeometry(p:Point[],rect:Rect){const top=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),bottom=Math.hypot(p[2].x-p[3].x,p[2].y-p[3].y),left=Math.hypot(p[3].x-p[0].x,p[3].y-p[0].y),right=Math.hypot(p[2].x-p[1].x,p[2].y-p[1].y);return Math.min(top,bottom)>=rectW(rect)*.28&&Math.min(left,right)>=rectH(rect)*.38}
function mergePoints(a:Array<Point|null>,b:Array<Point|null>){return a.map((p,i)=>p??b[i])}

export function inspectMarkerCorners(img:ImageData):boolean[]{
  const sheet=estimateSheetRect(img),component=componentCorners(img,sheet.rect);if(component.every(Boolean))return component.map(Boolean);
  const contrast=contrastMarkerCandidates(img,sheet.rect);return mergePoints(component,contrast).map(Boolean);
}

function detectMarkers(img:ImageData):{points:Point[];method:string;sheetMethod:string}{
  const{width:w,height:h}=img,names=["superior esquerdo","superior direito","inferior direito","inferior esquerdo"],sheet=estimateSheetRect(img);
  let pts=componentCorners(img,sheet.rect);if(pts.every(Boolean)&&validMarkerGeometry(pts as Point[],sheet.rect))return{points:pts as Point[],method:"sheet-component",sheetMethod:sheet.method};
  pts=mergePoints(pts,contrastMarkerCandidates(img,sheet.rect));if(pts.every(Boolean)&&validMarkerGeometry(pts as Point[],sheet.rect))return{points:pts as Point[],method:"sheet-contrast",sheetMethod:sheet.method};
  const global=fullRect(w,h);let globalPts=componentCorners(img,global);if(globalPts.every(Boolean)&&validMarkerGeometry(globalPts as Point[],global))return{points:globalPts as Point[],method:"global-component",sheetMethod:sheet.method};
  globalPts=mergePoints(globalPts,contrastMarkerCandidates(img,global));if(globalPts.every(Boolean)&&validMarkerGeometry(globalPts as Point[],global))return{points:globalPts as Point[],method:"global-contrast",sheetMethod:sheet.method};
  const missing=pts.map((p,i)=>p?null:names[i]).filter(Boolean).join(", ")||"geometria dos quatro pontos";
  throw new Error(`OMR ${OMR_VERSION}: os quatro marcadores não formaram um cartão válido. Falha: ${missing}. Na câmera, encaixe a folha no guia; em foto/PDF, mantenha a folha inteira visível.`);
}

// Real handwritten marks are often irregular or slightly off-centre. We deliberately
// search a little wider inside each bubble, but still stay inside the printed circle.
function sampleDisc(img:ImageData,H:number[],c:Point,r:number){let best={mean:0,variance:0,coverage:0};const rr=r*.52;for(const oy of[-6,-3,0,3,6])for(const ox of[-6,-3,0,3,6]){let sum=0,n=0,sq=0,ink=0;for(let yy=-rr;yy<=rr;yy+=2.5)for(let xx=-rr;xx<=rr;xx+=2.5){if(xx*xx+yy*yy>rr*rr)continue;const p=project(H,{x:c.x+ox+xx,y:c.y+oy+yy}),g=grayAt(img.data,img.width,img.height,p.x,p.y),d=1-g/255;sum+=d;sq+=d*d;if(d>.45)ink++;n++}const mean=sum/Math.max(1,n),variance=Math.max(0,sq/Math.max(1,n)-mean*mean),coverage=ink/Math.max(1,n);if(mean>best.mean)best={mean,variance,coverage}}return best}
function adaptiveThreshold(values:number[]){if(!values.length)return .34;let c1=Math.min(...values),c2=Math.max(...values);for(let it=0;it<12;it++){const a:number[]=[],b:number[]=[];for(const v of values)(Math.abs(v-c1)<Math.abs(v-c2)?a:b).push(v);if(a.length)c1=a.reduce((s,v)=>s+v,0)/a.length;if(b.length)c2=b.reduce((s,v)=>s+v,0)/b.length}const lo=Math.min(c1,c2),hi=Math.max(c1,c2);return hi-lo<.08?Math.max(.30,lo+.12):Math.max(.24,Math.min(.55,(lo+hi)/2))}

export function readOmr(img:ImageData,questions:number,alternatives:AnswerLetter[]):OmrOutput{const marker=detectMarkers(img),markerPoints=marker.points,H=homography(MARKER_CENTERS.map(p=>({...p})),markerPoints),scored=bubbleLayout(questions,alternatives).map(b=>({...b,...sampleDisc(img,H,b,b.r)})),threshold=adaptiveThreshold(scored.map(x=>x.mean)),reads:QuestionRead[]=[];for(let q=1;q<=questions;q++){const qv=scored.filter(x=>x.question===q).sort((a,b)=>b.mean-a.mean),above=qv.filter(x=>x.mean>=threshold).map(x=>x.letter),top=qv[0]?.mean??0,second=qv[1]?.mean??0,gap=top-second,topCoverage=qv[0]?.coverage??0,secondCoverage=qv[1]?.coverage??0;let state:QuestionRead["state"]="review";const blankLimit=Math.max(.38,threshold*.82),doubleLimit=Math.max(.62,threshold*1.02),markLimit=Math.max(.66,threshold*1.08);if(top<blankLimit&&topCoverage<.52)state="blank";else if(second>=doubleLimit&&secondCoverage>=.62&&top>=Math.max(.68,threshold*1.10)&&gap<.24)state="double";else if(top>=markLimit&&topCoverage>=.68&&gap>=.12)state="marked";const confidence=state==="marked"?Math.max(0,Math.min(1,(gap-.08)/.32)):state==="double"?Math.max(0,Math.min(1,(second-doubleLimit+.08)/.30)):state==="blank"?Math.max(0,Math.min(1,(blankLimit-top+.08)/.24)):Math.max(0,Math.min(1,Math.abs(top-threshold)/.20)),scores=Object.fromEntries(alternatives.map(l=>[l,qv.find(x=>x.letter===l)?.mean??0])) as Record<AnswerLetter,number>;const selected:AnswerLetter[]=state==="blank"?[]:state==="marked"?[qv[0].letter]:state==="double"?qv.slice(0,2).map(x=>x.letter):above.length?above:[qv[0].letter];reads.push({question:q,selected,scores,state,confidence})}return{reads,markerPoints,H,debug:{threshold,markerMethod:marker.method,sheetMethod:marker.sheetMethod}}}

export function drawOverlay(canvas:HTMLCanvasElement,img:HTMLImageElement|HTMLCanvasElement,out:OmrOutput,answerKey:AnswerLetter[]){const ctx=canvas.getContext("2d")!,width=img instanceof HTMLImageElement?img.naturalWidth:img.width,height=img instanceof HTMLImageElement?img.naturalHeight:img.height;canvas.width=width;canvas.height=height;ctx.drawImage(img,0,0,width,height);ctx.lineWidth=Math.max(2,canvas.width/500);ctx.strokeStyle="#2563eb";ctx.beginPath();out.markerPoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();const bubbles=bubbleLayout(out.reads.length,Object.keys(out.reads[0]?.scores??{}) as AnswerLetter[]);for(const r of out.reads)for(const l of r.selected){const b=bubbles.find(x=>x.question===r.question&&x.letter===l);if(!b)continue;const p=project(out.H,b),edge=project(out.H,{x:b.x+b.r*1.5,y:b.y}),rad=Math.max(8,Math.hypot(edge.x-p.x,edge.y-p.y));ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.strokeStyle=r.state!=="marked"?"#f59e0b":answerKey[r.question-1]===l?"#16a34a":"#dc2626";ctx.lineWidth=Math.max(3,canvas.width/330);ctx.stroke()}}