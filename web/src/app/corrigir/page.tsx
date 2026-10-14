"use client";
import { useEffect,useRef,useState } from "react";
import { Camera,Check,RefreshCw,Upload,AlertTriangle,X } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { addResult,getClass,listExams } from "@/lib/storage/local";
import { drawOverlay,readOmr } from "@/lib/omr/image";
import { gradeReads } from "@/lib/omr/grade";
import type { AnswerLetter,CorrectionResult,Exam,QuestionRead,Student } from "@/lib/types/domain";

async function fileToImage(file:File){const url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();return {img,url}}
function scaledImageData(img:HTMLImageElement,max=1800){const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement("canvas");c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);const ctx=c.getContext("2d")!;ctx.drawImage(img,0,0,c.width,c.height);return {canvas:c,imgData:ctx.getImageData(0,0,c.width,c.height)}}
function stopStream(stream?:MediaStream|null){stream?.getTracks().forEach(t=>t.stop())}

export default function CorrectPage(){
  const[exams,setExams]=useState<Exam[]>([]);const[examId,setExamId]=useState("");const[result,setResult]=useState<CorrectionResult>();const[error,setError]=useState("");const[busy,setBusy]=useState(false);const[student,setStudent]=useState<Student>();const[qrText,setQrText]=useState("");const[cameraOpen,setCameraOpen]=useState(false);const[cameraStream,setCameraStream]=useState<MediaStream|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);const videoRef=useRef<HTMLVideoElement>(null);const streamRef=useRef<MediaStream|null>(null);const cameraViewerRef=useRef<HTMLDivElement>(null);const exam=exams.find(e=>e.id===examId);

  useEffect(()=>{const es=listExams();setExams(es);const q=new URLSearchParams(location.search).get("exam");setExamId(q&&es.some(e=>e.id===q)?q:es[0]?.id??"");return()=>stopStream(streamRef.current)},[]);
  useEffect(()=>{if(videoRef.current&&cameraStream){videoRef.current.srcObject=cameraStream;void videoRef.current.play().catch(()=>{})}},[cameraStream,cameraOpen]);
  useEffect(()=>{if(!cameraOpen)return;const t=window.setTimeout(()=>centerCameraViewer(),120);return()=>window.clearTimeout(t)},[cameraOpen]);

  function centerCameraViewer(){
    const el=cameraViewerRef.current;if(!el)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const rect=el.getBoundingClientRect();
      const viewport=window.visualViewport?.height??window.innerHeight;
      const top=window.scrollY+rect.top-Math.max(12,(viewport-rect.height)/2);
      window.scrollTo({top:Math.max(0,top),behavior:"smooth"});
    }));
  }

  function closeCamera(){stopStream(streamRef.current);streamRef.current=null;setCameraStream(null);setCameraOpen(false)}

  async function openCamera(){
    setError("");
    if(!navigator.mediaDevices?.getUserMedia){setError("Este navegador não permite abrir a câmera diretamente. Use 'Escolher foto'.");return}
    try{
      closeCamera();
      let stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
      const track=stream.getVideoTracks()[0];
      const facing=track?.getSettings?.().facingMode;
      if(facing!=="environment"&&navigator.mediaDevices.enumerateDevices){
        try{
          const devices=await navigator.mediaDevices.enumerateDevices();
          const cameras=devices.filter(d=>d.kind==="videoinput");
          const rear=cameras.find(d=>/back|rear|environment|trase|trás|externa|wide|ultra/i.test(d.label));
          if(rear&&rear.deviceId&&rear.deviceId!==track?.getSettings?.().deviceId){
            const rearStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:rear.deviceId},width:{ideal:1920},height:{ideal:1080}}});
            stopStream(stream);stream=rearStream;
          }
        }catch{/* facingMode continua sendo o fallback */}
      }
      streamRef.current=stream;setCameraStream(stream);setCameraOpen(true);
    }catch(e){
      closeCamera();
      const name=e instanceof DOMException?e.name:"";
      if(name==="NotAllowedError"||name==="PermissionDeniedError")setError("Permissão da câmera negada. Autorize a câmera no navegador ou use 'Escolher foto'.");
      else setError("Não consegui abrir a câmera traseira. Você ainda pode escolher uma foto da galeria.");
    }
  }

  async function capturePhoto(){
    const video=videoRef.current;if(!video||!video.videoWidth||!video.videoHeight)return;
    const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;c.getContext("2d")!.drawImage(video,0,0,c.width,c.height);
    const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,"image/jpeg",.94));if(!blob)return;
    const file=new File([blob],`cartao-${Date.now()}.jpg`,{type:"image/jpeg"});closeCamera();await process(file);
  }

  async function process(file?:File){if(!file||!exam)return;setBusy(true);setError("");setResult(undefined);setStudent(undefined);setQrText("");let url="";try{const loaded=await fileToImage(file);const img=loaded.img;url=loaded.url;const{canvas:scaled,imgData}=scaledImageData(img);const out=readOmr(imgData,exam.questions,exam.alternatives);let stu:Student|undefined;let qr="";if(exam.mode==="student"){try{const decoded=await new BrowserQRCodeReader().decodeFromImageUrl(url);qr=decoded.getText();setQrText(qr);const[sig,qExam,sid]=qr.split("|");if(sig!=="GW1"||qExam!==exam.id)throw new Error("Este cartão pertence a outra prova.");const klass=exam.classId?getClass(exam.classId):undefined;stu=klass?.students.find(s=>s.id===sid);if(!stu)throw new Error("Aluno do QR não encontrado nesta turma.");setStudent(stu)}catch(e){throw new Error(e instanceof Error?e.message:"Não consegui ler o QR do aluno.")}}let graded=gradeReads(exam,out.reads,{studentId:stu?.id,studentName:stu?.name});const full=document.createElement("canvas");drawOverlay(full,scaled,out,exam.answerKey);const scale=Math.min(1,760/Math.max(full.width,full.height));const preview=document.createElement("canvas");preview.width=Math.round(full.width*scale);preview.height=Math.round(full.height*scale);preview.getContext("2d")!.drawImage(full,0,0,preview.width,preview.height);graded={...graded,imageDataUrl:preview.toDataURL("image/jpeg",.7)};setResult(graded)}catch(e){setError(e instanceof Error?e.message:"Falha ao processar imagem.")}finally{if(url)URL.revokeObjectURL(url);setBusy(false)}}

  function resolve(q:number,value:AnswerLetter|"blank"){if(!result||!exam)return;const reads=result.reads.map(r=>r.question===q?{...r,state:value==="blank"?"blank":"marked",selected:value==="blank"?[]:[value],confidence:1} as QuestionRead:r);setResult(gradeReads(exam,reads,{id:result.id,studentId:result.studentId,studentName:result.studentName,imageDataUrl:result.imageDataUrl}))}
  function saveNext(){if(!result)return;addResult(result);setResult(undefined);setStudent(undefined);setQrText("");if(exam?.mode==="student")void openCamera()}
  const pending=result?.reads.filter(r=>r.state==="double"||r.state==="review")??[];

  return <div className="container"><section className="hero"><div><div className="eyebrow">Correção</div><h1 className="h1">Aponte e corrija.</h1><p className="lead">Enquadre a folha inteira. Pequenas rotações e perspectiva são corrigidas pelos quatro marcadores.</p></div></section>{exams.length===0?<div className="empty"><strong>Crie uma prova primeiro</strong>A correção precisa conhecer o layout e o gabarito esperado.</div>:<><div className="field" style={{maxWidth:560,marginBottom:18}}><label>Prova</label><select className="select" value={examId} onChange={e=>{setExamId(e.target.value);setResult(undefined);setError("")}}>{exams.map(e=><option value={e.id} key={e.id}>{e.name} — {e.mode==="student"?"por aluno":"geral"}</option>)}</select></div><div className="camera-stage"><div className="card">
    <input ref={fileRef} type="file" accept="image/*" onChange={e=>process(e.target.files?.[0])} style={{display:"none"}}/>
    {!cameraOpen?<div className="capture" style={{cursor:"default"}}><div><div className="capture-icon">{busy?<RefreshCw className="spin"/>:<Camera size={30}/>}</div><b>{busy?"Lendo marcações...":"Fotografar cartão"}</b><div className="list-meta" style={{marginTop:6}}>No celular, abrimos preferencialmente a câmera traseira. Android e iOS são suportados.</div><div className="toolbar" style={{marginTop:16,justifyContent:"center"}}><button className="btn btn-primary" type="button" onClick={()=>void openCamera()} disabled={busy}><Camera size={16}/>Abrir câmera</button><button className="btn" type="button" onClick={()=>fileRef.current?.click()} disabled={busy}><Upload size={16}/>Escolher foto</button></div></div></div>:
    <div ref={cameraViewerRef}><div style={{position:"relative",borderRadius:14,overflow:"hidden",background:"#111"}}><video ref={videoRef} autoPlay muted playsInline onLoadedMetadata={centerCameraViewer} style={{display:"block",width:"100%",maxHeight:"70vh",objectFit:"contain"}}/><button type="button" className="btn" aria-label="Fechar câmera" onClick={closeCamera} style={{position:"absolute",top:10,right:10,padding:8}}><X size={18}/></button></div><div className="toolbar" style={{justifyContent:"center",marginTop:12}}><button className="btn btn-primary btn-lg" type="button" onClick={()=>void capturePhoto()}><Camera size={18}/>Capturar</button></div></div>}
    {exam?.mode==="student"&&<div className="callout" style={{marginTop:12}}>Modo turma: o QR identifica automaticamente o aluno. Depois de salvar, a câmera abre para o próximo.</div>}{error&&<div className="callout callout-warn" style={{marginTop:12}}><AlertTriangle size={15} style={{verticalAlign:"middle"}}/> {error}</div>}
  </div><div className="card">{!result?<div className="empty"><strong>A conferência aparecerá aqui</strong>Mostraremos exatamente quais bolhas o sistema considerou marcadas.</div>:<><div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"start",flexWrap:"wrap"}}><div>{student&&<div className="eyebrow">{student.name}</div>}<span className="score-big">{result.score.toLocaleString("pt-BR")}</span><span className="score-max"> / {exam?.maxScore}</span></div><span className={`pill ${pending.length?"pill-warn":"pill-good"}`}>{pending.length?`${pending.length} para revisar`:"Leitura concluída"}</span></div><div className="metrics"><div className="metric"><b>{result.correct}</b><span>ACERTOS</span></div><div className="metric"><b>{result.wrong}</b><span>ERROS</span></div><div className="metric"><b>{result.blank}</b><span>EM BRANCO</span></div><div className="metric"><b>{result.double}</b><span>DUPLAS</span></div><div className="metric"><b>{result.review}</b><span>REVISAR</span></div></div>{pending.length>0&&<div style={{marginTop:16}}><div className="callout callout-warn"><b>Confirmação humana necessária.</b> Marcação dupla/rasura não é decidida silenciosamente.</div><div className="list" style={{marginTop:10}}>{pending.map(r=><div className="list-item" key={r.question}><div className="list-main"><b>Questão {r.question}</b><div className="list-meta">Detectado: {r.selected.join(" + ")||"indefinido"}</div></div><div className="toolbar">{exam!.alternatives.map(a=><button className="btn" style={{padding:"7px 9px"}} key={a} onClick={()=>resolve(r.question,a)}>{a}</button>)}<button className="btn" style={{padding:"7px 9px"}} onClick={()=>resolve(r.question,"blank")}>Ø</button></div></div>)}</div></div>}{result.imageDataUrl&&<img className="preview" src={result.imageDataUrl} alt="Conferência da leitura OMR" style={{marginTop:16,width:"100%",height:"auto"}}/>}<button className="btn btn-primary btn-lg" style={{width:"100%",marginTop:14}} onClick={saveNext} disabled={pending.length>0}><Check size={18}/>{exam?.mode==="student"?"Salvar e corrigir próximo":"Salvar correção"}</button>{qrText&&<div className="stat-sub" style={{marginTop:8}}>QR confirmado.</div>}</>}</div></div></>}</div>}
