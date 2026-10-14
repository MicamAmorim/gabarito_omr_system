import { MARKER_CENTERS, bubbleLayout } from "./layout";
import { homography, project, type Point } from "./homography";
import type { AnswerLetter, QuestionRead } from "@/lib/types/domain";

export const OMR_VERSION="1.1.4";
export interface OmrOutput { reads:QuestionRead[]; markerPoints:Point[]; H:number[]; debug:{threshold:number;markerMethod?:string} }

function grayAt(data:Uint8ClampedArray,w:number,h:number,x:number,y:number){const ix=Math.max(0,Math.min(w-1,Math.round(x))),iy=Math.max(0,Math.min(h-1,Math.round(y)));const i=(iy*w+ix)*4;return .299*data[i]+.587*data[i+1]+.114*data[i+2]}

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
    const bw=maxx-minx+1,bh=maxy-miny+1,aspect=Math.min(bw,bh)/Math.max(bw,bh),fill=area/(bw*bh),regionFill=area/(rw*rh),maxSide=Math.min(rw,rh)*.34;
    if(aspect<.58||fill<.45||regionFill>.10||bw>maxSide||bh>maxSide)continue;
    const cx=sumx/area,cy=sumy/area,dist=Math.hypot(cx-target.x,cy-target.y)/Math.hypot(rw,rh),size=Math.sqrt(area)/Math.min(rw,rh),score=size*2.2+fill+aspect-dist*1.25;
    if(!best||score>best.score)best={score,x:sx+cx,y:sy+cy};
  }
  return best?{x:best.x,y:best.y}:null;
}

function contrastMarkerCandidates(img:ImageData):Point[]{
  const{width:w,height:h,data}=img,maxDim=480,s=Math.min(1,maxDim/Math.max(w,h)),dw=Math.max(80,Math.round(w*s)),dh=Math.max(80,Math.round(h*s));
  const small=new Float32Array(dw*dh);
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++)small[y*dw+x]=grayAt(data,w,h,(x+.5)/s-.5,(y+.5)/s-.5);
  const stride=dw+1,integ=new Float64Array((dw+1)*(dh+1));
  for(let y=0;y<dh;y++){let row=0;for(let x=0;x<dw;x++){row+=small[y*dw+x];integ[(y+1)*stride+x+1]=integ[y*stride+x+1]+row}}
  function mean(x0:number,y0:number,x1:number,y1:number){x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(dw,Math.ceil(x1));y1=Math.min(dh,Math.ceil(y1));if(x1<=x0||y1<=y0)return 255;const sum=integ[y1*stride+x1]-integ[y0*stride+x1]-integ[y1*stride+x0]+integ[y0*stride+x0];return sum/((x1-x0)*(y1-y0))}
  const bounds=[[0,.45,0,.40],[.55,1,0,.40],[.55,1,.60,1],[0,.45,.60,1]];
  const targets=[[0,0],[dw,0],[dw,dh],[0,dh]];
  const out:Point[]=[];
  const minSide=Math.min(dw,dh),sMin=Math.max(6,Math.floor(minSide*.018)),sMax=Math.max(sMin+2,Math.floor(minSide*.075));
  for(let corner=0;corner<4;corner++){
    const b=bounds[corner],x0=Math.floor(dw*b[0]),x1=Math.ceil(dw*b[1]),y0=Math.floor(dh*b[2]),y1=Math.ceil(dh*b[3]),target=targets[corner];
    let best:{score:number;cx:number;cy:number;inner:number;contrast:number}|null=null;
    for(let side=sMin;side<=sMax;side+=2){
      const ring=Math.max(3,Math.round(side*.45)),outerArea=(side+2*ring)*(side+2*ring),innerArea=side*side,ringArea=outerArea-innerArea;
      for(let y=y0+ring;y+side+ring<y1;y+=2)for(let x=x0+ring;x+side+ring<x1;x+=2){
        const inner=mean(x,y,x+side,y+side),outer=mean(x-ring,y-ring,x+side+ring,y+side+ring),ringMean=(outer*outerArea-inner*innerArea)/Math.max(1,ringArea),contrast=ringMean-inner;
        const cx=x+side/2,cy=y+side/2,dist=Math.hypot(cx-target[0],cy-target[1])/Math.hypot(dw,dh),score=contrast*1.2+(180-inner)*.5-dist*25;
        if((!best||score>best.score)&&inner<150&&contrast>22)best={score,cx,cy,inner,contrast};
      }
    }
    if(!best)throw new Error(`OMR ${OMR_VERSION}: detector de contraste não encontrou o marcador ${["superior esquerdo","superior direito","inferior direito","inferior esquerdo"][corner]}.`);
    out.push({x:best.cx/s,y:best.cy/s});
  }
  return out;
}

function validMarkerGeometry(p:Point[],w:number,h:number){
  const top=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),bottom=Math.hypot(p[2].x-p[3].x,p[2].y-p[3].y),left=Math.hypot(p[3].x-p[0].x,p[3].y-p[0].y),right=Math.hypot(p[2].x-p[1].x,p[2].y-p[1].y);
  return Math.min(top,bottom)>=w*.28&&Math.min(left,right)>=h*.38;
}

function detectMarkers(img:ImageData):{points:Point[];method:string}{
  const{width:w,height:h,data}=img;
  const names=["superior esquerdo","superior direito","inferior direito","inferior esquerdo"];
  const scales:[[number,number],[number,number],[number,number],[number,number]]=[[.23,.18],[.31,.25],[.40,.34],[.48,.42]];
  const pts:(Point|null)[]=[null,null,null,null];
  for(const[fx,fy]of scales){
    const rx=w*fx,ry=h*fy,regions=[[0,0,rx,ry],[w-rx,0,w,ry],[w-rx,h-ry,w,h],[0,h-ry,rx,h]];
    for(let i=0;i<4;i++)if(!pts[i]){const r=regions[i];pts[i]=markerComponent(data,w,h,r[0],r[1],r[2],r[3],i)}
    if(pts.every(Boolean))break;
  }
  if(pts.every(Boolean)&&validMarkerGeometry(pts as Point[],w,h))return{points:pts as Point[],method:"component"};
  try{
    const fallback=contrastMarkerCandidates(img);
    if(validMarkerGeometry(fallback,w,h))return{points:fallback,method:"contrast"};
    throw new Error("geometria inválida");
  }catch{
    const missing=pts.map((p,i)=>p?null:names[i]).filter(Boolean).join(", ")||"geometria dos quatro pontos";
    throw new Error(`OMR ${OMR_VERSION}: os marcadores estão visíveis, mas não consegui formar um quadrilátero válido. Falha inicial: ${missing}. Tente manter a folha inteira no quadro.`);
  }
}

function sampleDisc(img:ImageData,H:number[],c:Point,r:number){let best={mean:0,variance:0,coverage:0};const rr=r*.48;for(const oy of[-4,0,4])for(const ox of[-4,0,4]){let sum=0,n=0,sq=0,ink=0;for(let yy=-rr;yy<=rr;yy+=2.5)for(let xx=-rr;xx<=rr;xx+=2.5){if(xx*xx+yy*yy>rr*rr)continue;const p=project(H,{x:c.x+ox+xx,y:c.y+oy+yy}),g=grayAt(img.data,img.width,img.height,p.x,p.y),d=1-g/255;sum+=d;sq+=d*d;if(d>.45)ink++;n++}const mean=sum/Math.max(1,n),variance=Math.max(0,sq/Math.max(1,n)-mean*mean),coverage=ink/Math.max(1,n);if(mean>best.mean)best={mean,variance,coverage}}return best}
function adaptiveThreshold(values:number[]){if(!values.length)return .34;let c1=Math.min(...values),c2=Math.max(...values);for(let it=0;it<12;it++){const a:number[]=[],b:number[]=[];for(const v of values)(Math.abs(v-c1)<Math.abs(v-c2)?a:b).push(v);if(a.length)c1=a.reduce((s,v)=>s+v,0)/a.length;if(b.length)c2=b.reduce((s,v)=>s+v,0)/b.length}const lo=Math.min(c1,c2),hi=Math.max(c1,c2);return hi-lo<.08?Math.max(.30,lo+.12):Math.max(.24,Math.min(.55,(lo+hi)/2))}

export function readOmr(img:ImageData,questions:number,alternatives:AnswerLetter[]):OmrOutput{const marker=detectMarkers(img),markerPoints=marker.points,H=homography(MARKER_CENTERS.map(p=>({...p})),markerPoints),scored=bubbleLayout(questions,alternatives).map(b=>({...b,...sampleDisc(img,H,b,b.r)})),threshold=adaptiveThreshold(scored.map(x=>x.mean)),reads:QuestionRead[]=[];for(let q=1;q<=questions;q++){const qv=scored.filter(x=>x.question===q).sort((a,b)=>b.mean-a.mean),above=qv.filter(x=>x.mean>=threshold).map(x=>x.letter),top=qv[0]?.mean??0,second=qv[1]?.mean??0,gap=top-second,topCoverage=qv[0]?.coverage??0,secondCoverage=qv[1]?.coverage??0,topVariance=qv[0]?.variance??1;let state:QuestionRead["state"]="marked";if(topCoverage<.45&&gap<.055&&top<threshold*.95)state="blank";else if(topCoverage>.90&&secondCoverage>.90&&second>=threshold*.82)state="double";else if(topCoverage>.82&&topVariance<.03&&gap>.075)state="marked";else state="review";const confidence=state==="marked"?Math.max(0,Math.min(1,gap/.24)):Math.max(0,Math.min(1,Math.abs(top-threshold)/.20)),scores=Object.fromEntries(alternatives.map(l=>[l,qv.find(x=>x.letter===l)?.mean??0])) as Record<AnswerLetter,number>;const selected:AnswerLetter[]=state==="blank"?[]:state==="marked"?[qv[0].letter]:state==="double"?qv.slice(0,2).map(x=>x.letter):above.length?above:[qv[0].letter];reads.push({question:q,selected,scores,state,confidence})}return{reads,markerPoints,H,debug:{threshold,markerMethod:marker.method}}}

export function drawOverlay(canvas:HTMLCanvasElement,img:HTMLImageElement|HTMLCanvasElement,out:OmrOutput,answerKey:AnswerLetter[]){const ctx=canvas.getContext("2d")!,width=img instanceof HTMLImageElement?img.naturalWidth:img.width,height=img instanceof HTMLImageElement?img.naturalHeight:img.height;canvas.width=width;canvas.height=height;ctx.drawImage(img,0,0,width,height);ctx.lineWidth=Math.max(2,canvas.width/500);ctx.strokeStyle="#2563eb";ctx.beginPath();out.markerPoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();const bubbles=bubbleLayout(out.reads.length,Object.keys(out.reads[0]?.scores??{}) as AnswerLetter[]);for(const r of out.reads)for(const l of r.selected){const b=bubbles.find(x=>x.question===r.question&&x.letter===l);if(!b)continue;const p=project(out.H,b),edge=project(out.H,{x:b.x+b.r*1.5,y:b.y}),rad=Math.max(8,Math.hypot(edge.x-p.x,edge.y-p.y));ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.strokeStyle=r.state!=="marked"?"#f59e0b":answerKey[r.question-1]===l?"#16a34a":"#dc2626";ctx.lineWidth=Math.max(3,canvas.width/330);ctx.stroke()}}
