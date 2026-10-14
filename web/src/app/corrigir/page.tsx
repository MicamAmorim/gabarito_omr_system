"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { Camera,Check,RefreshCw,Upload,AlertTriangle,X,Eye } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { addResult,addResultsBatch,listClasses,listExams } from "@/lib/storage/local";
import { findExamStudent } from "@/lib/exams/class-links";
import { drawOverlay,inspectMarkerCorners,readOmr } from "@/lib/omr/image";
import { gradeReads } from "@/lib/omr/grade";
import { renderPdfPages } from "@/lib/pdf/render";
import type { AnswerLetter,CorrectionResult,Exam,QuestionRead,SchoolClass,Student } from "@/lib/types/domain";

const A4_RATIO=210/297;
async function fileToImage(file:File){const url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();return {img,url}}
function scaledCanvas(img:HTMLImageElement,max=1800){const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);const ctx=c.getContext("2d")!;ctx.drawImage(img,0,0,c.width,c.height);return c}
function stopStream(stream?:MediaStream|null){stream?.getTracks().forEach(t=>t.stop())}
function isPdf(file:File){return file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")}
function resultLabel(r:CorrectionResult){return r.studentName??(r.sourcePage?`Leitura ${r.sourcePage}`:"Cartão geral")}
function guideRect(w:number,h:number){const maxW=w*.84,maxH=h*.86;let gh=maxH,gw=gh*A4_RATIO;if(gw>maxW){gw=maxW;gh=gw/A4_RATIO}return{x:(w-gw)/2,y:(h-gh)/2,w:gw,h:gh}}
function guideCanvas(video:HTMLVideoElement,maxDim=1600,pad=.04){const g=guideRect(video.videoWidth,video.videoHeight),px=g.w*pad,py=g.h*pad,sx=Math.max(0,g.x-px),sy=Math.max(0,g.y-py),ex=Math.min(video.videoWidth,g.x+g.w+px),ey=Math.min(video.videoHeight,g.y+g.h+py),sw=ex-sx,sh=ey-sy,scale=Math.min(1,maxDim/Math.max(sw,sh));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(sw*scale));c.height=Math.max(1,Math.round(sh*scale));c.getContext("2d")!.drawImage(video,sx,sy,sw,sh,0,0,c.width,c.height);return c}

export default function CorrectPage(){
  const[exams,setExams]=useState<Exam[]>([]);const[examId,setExamId]=useState("");const[result,setResult]=useState<CorrectionResult>();const[batchResults,setBatchResults]=useState<CorrectionResult[]>([]);const[batchFailures,setBatchFailures]=useState<string[]>([]);const[error,setError]=useState("");const[busy,setBusy]=useState(false);const[student,setStudent]=useState<Student>();const[qrText,setQrText]=useState("");const[cameraOpen,setCameraOpen]=useState(false);const[cameraStream,setCameraStream]=useState<MediaStream|null>(null);const[pdfProgress,setPdfProgress]=useState<{current:number,total:number}|null>(null);const[videoSize,setVideoSize]=useState<{w:number;h:number}|null>(null);const[markerMask,setMarkerMask]=useState<boolean[]>([false,false,false,false]);
  const fileRef=useRef<HTMLInputElement>(null);const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const cameraViewerRef=useRef<HTMLDivElement>(null);const exam=exams.find(e=>e.id===examId);

  useEffect(()=>{const es=listExams();setExams(es);const q=new URLSearchParams(location.search).get("exam");setExamId(q&&es.some(e=>e.id===q)?q:es[0]?.id??"");return()=>stopStream(streamRef.current)},[]);
  useEffect(()=>{if(videoRef.current&&cameraStream){videoRef.current.srcObject=cameraStream;void videoRef.current.play().catch(()=>{})}},[cameraStream,cameraOpen]);
  useEffect(()=>{if(!cameraOpen)return;const t=window.setTimeout(()=>centerCameraViewer(),120);return()=>window.clearTimeout(t)},[cameraOpen]);
  useEffect(()=>{
    if(!cameraOpen||!cameraStream||!videoSize)return;
    let running=true;
    const inspect=()=>{if(!running)return;const video=videoRef.current;if(!video||video.readyState<2||!video.videoWidth)return;try{const c=guideCanvas(video,720,.015),ctx=c.getContext("2d",{willReadFrequently:true});if(!ctx)return;setMarkerMask(inspectMarkerCorners(ctx.getImageData(0,0,c.width,c.height)))}catch{setMarkerMask([false,false,false,false])}};
    inspect();const timer=window.setInterval(inspect,700);return()=>{running=false;window.clearInterval(timer)};
  },[cameraOpen,cameraStream,videoSize]);

  function centerCameraViewer(){const el=cameraViewerRef.current;if(!el)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const rect=el.getBoundingClientRect();const viewport=window.visualViewport?.height??window.innerHeight;const top=window.scrollY+rect.top-Math.max(12,(viewport-rect.height)/2);window.scrollTo({top:Math.max(0,top),behavior:"smooth"})}))}
  function closeCamera(){stopStream(streamRef.current);streamRef.current=null;setCameraStream(null);setCameraOpen(false);setVideoSize(null);setMarkerMask([false,false,false,false])}

  async function openCamera(){
    setError("");setBatchResults([]);setBatchFailures([]);
    if(!navigator.mediaDevices?.getUserMedia){setError("Este navegador não permite abrir a câmera diretamente. Use 'Escolher foto/PDF'.");return}
    try{
      closeCamera();
      let stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
      const track=stream.getVideoTracks()[0];const facing=track?.getSettings?.().facingMode;
      if(facing!=="environment"&&navigator.mediaDevices.enumerateDevices){try{const devices=await navigator.mediaDevices.enumerateDevices();const cameras=devices.filter(d=>d.kind==="videoinput");const rear=cameras.find(d=>/back|rear|environment|trase|trás|externa|wide|ultra/i.test(d.label));if(rear&&rear.deviceId&&rear.deviceId!==track?.getSettings?.().deviceId){const rearStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:rear.deviceId},width:{ideal:1920},height:{ideal:1080}}});stopStream(stream);stream=rearStream}}catch{/* facingMode é o fallback */}}
      streamRef.current=stream;setCameraStream(stream);setCameraOpen(true);
    }catch(e){closeCamera();const name=e instanceof DOMException?e.name:"";if(name==="NotAllowedError"||name==="PermissionDeniedError")setError("Permissão da câmera negada. Autorize a câmera no navegador ou use 'Escolher foto/PDF'.");else setError("Não consegui abrir a câmera traseira. Você ainda pode escolher uma foto da galeria.")}
  }

  async function capturePhoto(){const video=videoRef.current;if(!video||!video.videoWidth||!video.videoHeight)return;const c=guideCanvas(video,1900,.045);const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,"image/jpeg",.94));if(!blob)return;const file=new File([blob],`cartao-${Date.now()}.jpg`,{type:"image/jpeg"});closeCamera();await processImageFile(file)}

  async function gradeCanvas(canvas:HTMLCanvasElement,meta:Partial<CorrectionResult>={},qrSource?:string){
    if(!exam)throw new Error("Selecione uma prova.");
    const ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)throw new Error("Não consegui preparar a imagem.");
    const out=readOmr(ctx.getImageData(0,0,canvas.width,canvas.height),exam.questions,exam.alternatives);
    let stu:Student|undefined;let klass:SchoolClass|undefined;let qr="";
    if(exam.mode==="student"){
      try{
        const source=qrSource??canvas.toDataURL("image/jpeg",.9);
        const decoded=await new BrowserQRCodeReader().decodeFromImageUrl(source);qr=decoded.getText();
        const[sig,qExam,sid]=qr.split("|");if(sig!=="GW1"||qExam!==exam.id)throw new Error("Este cartão pertence a outra prova.");
        const match=findExamStudent(exam,listClasses(),sid);stu=match?.student;klass=match?.klass;if(!stu||!klass)throw new Error("Aluno do QR não encontrado nas turmas associadas a esta prova.");
      }catch(e){throw new Error(e instanceof Error?e.message:"Não consegui ler o QR do aluno.")}
    }
    let graded=gradeReads(exam,out.reads,{...meta,studentId:stu?.id,studentName:stu?.name,classId:klass?.id,className:klass?.name});
    const full=document.createElement("canvas");drawOverlay(full,canvas,out,exam.answerKey);
    const scale=Math.min(1,1200/Math.max(full.width,full.height));const preview=document.createElement("canvas");preview.width=Math.round(full.width*scale);preview.height=Math.round(full.height*scale);preview.getContext("2d")!.drawImage(full,0,0,preview.width,preview.height);
    graded={...graded,imageDataUrl:preview.toDataURL("image/jpeg",.84)};
    return {graded,stu,qr};
  }

  async function processImageFile(file?:File){if(!file||!exam)return;setBusy(true);setError("");setResult(undefined);setBatchResults([]);setBatchFailures([]);setStudent(undefined);setQrText("");let url="";try{const loaded=await fileToImage(file);url=loaded.url;const canvas=scaledCanvas(loaded.img);const{graded,stu,qr}=await gradeCanvas(canvas,{},url);setStudent(stu);setQrText(qr);setResult(graded)}catch(e){setError(e instanceof Error?e.message:"Falha ao processar imagem.")}finally{if(url)URL.revokeObjectURL(url);setBusy(false)}}

  async function processPdf(file:File){
    if(!exam)return;setBusy(true);setError("");setResult(undefined);setStudent(undefined);setQrText("");setBatchResults([]);setBatchFailures([]);
    try{
      const pages=await renderPdfPages(file,2200);
      if(!pages.length)throw new Error("O PDF não possui páginas para corrigir.");
      if(pages.length===1){setPdfProgress({current:1,total:1});const{graded,stu,qr}=await gradeCanvas(pages[0].canvas,{sourceName:file.name,sourcePage:1,batchSize:1});setStudent(stu);setQrText(qr);setResult(graded);return}
      const batchId=crypto.randomUUID();const done:CorrectionResult[]=[];const failures:string[]=[];
      for(const page of pages){setPdfProgress({current:page.pageNumber,total:pages.length});try{const{graded}=await gradeCanvas(page.canvas,{batchId,sourceName:file.name,sourcePage:page.pageNumber,batchSize:pages.length});done.push(graded)}catch(e){failures.push(`Página ${page.pageNumber}: ${e instanceof Error?e.message:"falha de leitura"}`)}}
      if(done.length)addResultsBatch(done);
      setBatchResults(done);setBatchFailures(failures);
      if(!done.length)throw new Error("Nenhuma página do PDF pôde ser corrigida.");
    }catch(e){setError(e instanceof Error?e.message:"Falha ao processar PDF.")}finally{setPdfProgress(null);setBusy(false)}
  }

  async function processSelected(file?:File){if(!file)return;try{if(isPdf(file))await processPdf(file);else await processImageFile(file)}finally{if(fileRef.current)fileRef.current.value=""}}
  function resolve(q:number,value:AnswerLetter|"blank"){if(!result||!exam)return;const reads=result.reads.map(r=>r.question===q?{...r,state:value==="blank"?"blank":"marked",selected:value==="blank"?[]:[value],confidence:1} as QuestionRead:r);setResult(gradeReads(exam,reads,{id:result.id,studentId:result.studentId,studentName:result.studentName,classId:result.classId,className:result.className,imageDataUrl:result.imageDataUrl,batchId:result.batchId,sourceName:result.sourceName,sourcePage:result.sourcePage,batchSize:result.batchSize}))}
  function saveNext(){if(!result)return;addResult(result);setResult(undefined);setStudent(undefined);setQrText("");if(exam?.mode==="student")void openCamera()}
  const pending=result?.reads.filter(r=>r.state==="double"||r.state==="review")??[];
  const busyText=pdfProgress?`Lendo PDF ${pdfProgress.current}/${pdfProgress.total}...`:"Lendo marcações...";
  const markerCount=markerMask.filter(Boolean).length,guide=videoSize?guideRect(videoSize.w,videoSize.h):null;

  return <div className="container"><section className="hero"><div><div className="eyebrow">Correção</div><h1 className="h1">Aponte e corrija.</h1><p className="lead">Use a câmera, uma foto ou um PDF. PDFs com várias páginas são corrigidos em lote, mantendo a ordem das páginas.</p></div></section>{exams.length===0?<div className="empty"><strong>Crie uma prova primeiro</strong>A correção precisa conhecer o layout e o gabarito esperado.</div>:<><div className="field" style={{maxWidth:560,marginBottom:18}}><label>Prova</label><select className="select" value={examId} onChange={e=>{setExamId(e.target.value);setResult(undefined);setBatchResults([]);setBatchFailures([]);setError("")}}>{exams.map(e=><option value={e.id} key={e.id}>{e.name} — {e.mode==="student"?"por aluno":"geral"}</option>)}</select></div><div className="camera-stage"><div className="card">
    <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" onChange={e=>void processSelected(e.target.files?.[0])} style={{display:"none"}}/>
    {!cameraOpen?<div className="capture" style={{cursor:"default"}}><div><div className="capture-icon">{busy?<RefreshCw className="spin"/>:<Camera size={30}/>}</div><b>{busy?busyText:"Fotografar ou importar"}</b><div className="list-meta" style={{marginTop:6}}>Câmera traseira no celular, imagem da galeria ou PDF de uma ou várias páginas.</div><div className="toolbar" style={{marginTop:16,justifyContent:"center"}}><button className="btn btn-primary" type="button" onClick={()=>void openCamera()} disabled={busy}><Camera size={16}/>Abrir câmera</button><button className="btn" type="button" onClick={()=>fileRef.current?.click()} disabled={busy}><Upload size={16}/>Escolher foto/PDF</button></div></div></div>:
    <div ref={cameraViewerRef}><div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#111"}}><video ref={videoRef} autoPlay muted playsInline onLoadedMetadata={()=>{const v=videoRef.current;if(v)setVideoSize({w:v.videoWidth,h:v.videoHeight});centerCameraViewer()}} style={{display:"block",width:"100%",maxHeight:"70vh",objectFit:"contain"}}/>{guide&&videoSize&&<div aria-hidden="true" style={{position:"absolute",pointerEvents:"none",left:`${guide.x/videoSize.w*100}%`,top:`${guide.y/videoSize.h*100}%`,width:`${guide.w/videoSize.w*100}%`,height:`${guide.h/videoSize.h*100}%`,border:"1px dashed rgba(255,255,255,.65)",borderRadius:8,boxShadow:"0 0 0 999px rgba(0,0,0,.12)"}}>{[0,1,2,3].map(i=>{const color=markerMask[i]?"#22c55e":"rgba(255,255,255,.95)",top=i<2,bottom=i>=2,left=i===0||i===3,right=i===1||i===2;return <span key={i} style={{position:"absolute",width:34,height:34,top:top?-3:undefined,bottom:bottom?-3:undefined,left:left?-3:undefined,right:right?-3:undefined,borderTop:top?`4px solid ${color}`:undefined,borderBottom:bottom?`4px solid ${color}`:undefined,borderLeft:left?`4px solid ${color}`:undefined,borderRight:right?`4px solid ${color}`:undefined,borderRadius:5}}/>})}<div style={{position:"absolute",left:"50%",bottom:9,transform:"translateX(-50%)",background:markerCount===4?"rgba(22,163,74,.92)":"rgba(15,23,42,.76)",color:"white",borderRadius:999,padding:"5px 9px",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>{markerCount}/4 marcadores</div></div>}<button type="button" className="btn" aria-label="Fechar câmera" onClick={closeCamera} style={{position:"absolute",top:10,right:10,padding:8}}><X size={18}/></button></div><div className="list-meta" style={{textAlign:"center",marginTop:10}}>Encaixe a folha inteira no guia. Os quatro cantos ficam verdes quando os marcadores são localizados.</div><div className="toolbar" style={{justifyContent:"center",marginTop:12}}><button className="btn btn-primary btn-lg" type="button" onClick={()=>void capturePhoto()}><Camera size={18}/>Capturar</button></div></div>}
    {exam?.mode==="student"&&<div className="callout" style={{marginTop:12}}>Modo turma: foto e PDF usam o QR para identificar automaticamente o aluno em qualquer uma das turmas associadas à prova.</div>}{exam?.mode==="general"&&<div className="callout" style={{marginTop:12}}>Modo geral: em PDF multipágina, os resultados são salvos como Leitura 1, Leitura 2, ... exatamente na ordem das páginas.</div>}{error&&<div className="callout callout-warn" style={{marginTop:12}}><AlertTriangle size={15} style={{verticalAlign:"middle"}}/> {error}</div>}
  </div><div className="card">{batchResults.length>0?<><div className="section-title" style={{marginTop:0}}><div><div className="eyebrow">PDF concluído</div><h2 style={{margin:"4px 0 0"}}>{batchResults.length} página(s) corrigida(s)</h2></div><Link href="/resultados" className="btn"><Eye size={16}/>Ver resultados</Link></div><div className="list">{batchResults.map(r=><div className="list-item" key={r.id}><div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>{r.imageDataUrl&&<img src={r.imageDataUrl} alt={`Conferência ${resultLabel(r)}`} style={{width:58,height:76,objectFit:"cover",borderRadius:8,border:"1px solid var(--border, #ddd)"}}/>}<div className="list-main"><b>{resultLabel(r)}</b><div className="list-meta">{r.className?`${r.className} · `:""}{r.sourcePage&&`Página ${r.sourcePage} · `}Nota {r.score.toLocaleString("pt-BR")} · {r.review+r.double?`${r.review+r.double} para revisar`:"leitura concluída"}</div></div></div></div>)}</div>{batchFailures.length>0&&<div className="callout callout-warn" style={{marginTop:12}}><b>{batchFailures.length} página(s) não foram salvas.</b><div style={{marginTop:6}}>{batchFailures.join(" · ")}</div></div>}</>:!result?<div className="empty"><strong>A conferência aparecerá aqui</strong>Mostraremos exatamente quais bolhas o sistema considerou marcadas.</div>:<><div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"start",flexWrap:"wrap"}}><div>{student&&<div className="eyebrow">{student.name}{result.className?` · ${result.className}`:""}</div>}{result.sourcePage&&<div className="eyebrow">PDF · página {result.sourcePage}</div>}<span className="score-big">{result.score.toLocaleString("pt-BR")}</span><span className="score-max"> / {exam?.maxScore}</span></div><span className={`pill ${pending.length?"pill-warn":"pill-good"}`}>{pending.length?`${pending.length} para revisar`:"Leitura concluída"}</span></div><div className="metrics"><div className="metric"><b>{result.correct}</b><span>ACERTOS</span></div><div className="metric"><b>{result.wrong}</b><span>ERROS</span></div><div className="metric"><b>{result.blank}</b><span>EM BRANCO</span></div><div className="metric"><b>{result.double}</b><span>DUPLAS</span></div><div className="metric"><b>{result.review}</b><span>REVISAR</span></div></div>{pending.length>0&&<div style={{marginTop:16}}><div className="callout callout-warn"><b>Confirmação humana necessária.</b> Marcação dupla/rasura não é decidida silenciosamente.</div><div className="list" style={{marginTop:10}}>{pending.map(r=><div className="list-item" key={r.question}><div className="list-main"><b>Questão {r.question}</b><div className="list-meta">Detectado: {r.selected.join(" + ")||"indefinido"}</div></div><div className="toolbar">{exam!.alternatives.map(a=><button className="btn" style={{padding:"7px 9px"}} key={a} onClick={()=>resolve(r.question,a)}>{a}</button>)}<button className="btn" style={{padding:"7px 9px"}} onClick={()=>resolve(r.question,"blank")}>Ø</button></div></div>)}</div></div>}{result.imageDataUrl&&<img className="preview" src={result.imageDataUrl} alt="Conferência da leitura OMR" style={{marginTop:16,width:"100%",height:"auto"}}/>}<button className="btn btn-primary btn-lg" style={{width:"100%",marginTop:14}} onClick={saveNext} disabled={pending.length>0}><Check size={18}/>{exam?.mode==="student"?"Salvar e corrigir próximo":"Salvar correção"}</button>{qrText&&<div className="stat-sub" style={{marginTop:8}}>QR confirmado.</div>}</>}</div></div></>}</div>}
