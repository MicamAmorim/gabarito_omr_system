"use client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import type { Exam, SchoolClass, Student } from "@/lib/types/domain";
import { bubbleLayout, MARKER_CENTERS, MARKER_SIZE, SHEET } from "@/lib/omr/layout";

const PT_W=595.28, PT_H=841.89;
const sx=PT_W/SHEET.width, sy=PT_H/SHEET.height;
const X=(x:number)=>x*sx, Y=(y:number)=>PT_H-y*sy;

async function addSheet(pdf:PDFDocument, exam:Exam, student?:Student, klass?:SchoolClass){
  const page=pdf.addPage([PT_W,PT_H]);
  const font=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const m of MARKER_CENTERS){ page.drawRectangle({x:X(m.x-MARKER_SIZE/2),y:Y(m.y+MARKER_SIZE/2),width:X(MARKER_SIZE),height:MARKER_SIZE*sy,color:rgb(0,0,0)}); }
  page.drawText("CARTAO-RESPOSTA",{x:PT_W/2-80,y:PT_H-55,size:15,font:bold});
  page.drawText(exam.name,{x:70,y:PT_H-82,size:11,font:bold});
  page.drawText(`${exam.subject} • ${exam.questions} questoes • Nota maxima ${exam.maxScore}`,{x:70,y:PT_H-99,size:8.5,font});
  page.drawText(student?`Aluno: ${student.name}`:"Aluno: ______________________________________________",{x:70,y:PT_H-123,size:9,font});
  if(klass) page.drawText(`Turma: ${klass.name}`,{x:70,y:PT_H-140,size:8.5,font});
  const payload=student?`GW1|${exam.id}|${student.id}`:`GW1|${exam.id}|GENERAL`;
  const qrData=await QRCode.toDataURL(payload,{margin:0,width:220,errorCorrectionLevel:"M"});
  const qr=await pdf.embedPng(qrData); page.drawImage(qr,{x:PT_W-125,y:PT_H-150,width:60,height:60});
  page.drawText(payload,{x:PT_W-150,y:PT_H-158,size:4.7,font});
  const bubbles=bubbleLayout(exam.questions,exam.alternatives);
  const groups=new Map<number,typeof bubbles>(); for(const b of bubbles){if(!groups.has(b.question))groups.set(b.question,[]);groups.get(b.question)!.push(b)}
  for(const [q,items] of groups){ const first=items[0]; page.drawText(String(q).padStart(2,"0"),{x:X(first.x-66),y:Y(first.y)+3,size:7.5,font:bold});
    for(const b of items){ page.drawCircle({x:X(b.x),y:Y(b.y),size:Math.max(4,b.r*sx),borderWidth:.75,borderColor:rgb(.08,.08,.08)}); page.drawText(b.letter,{x:X(b.x)-2.1,y:Y(b.y)-2.2,size:5.5,font}); }
  }
  page.drawText("Preencha completamente uma alternativa por questao. Em caso de rasura, a leitura podera solicitar revisao.",{x:70,y:55,size:6.8,font});
  page.drawText("Nao recorte os quatro quadrados pretos: eles sao usados para corrigir perspectiva e rotacao.",{x:70,y:43,size:6.8,font});
}

export async function downloadAnswerSheets(exam:Exam, klass?:SchoolClass){
  const pdf=await PDFDocument.create();
  if(exam.mode==="student" && klass){ for(const student of klass.students) await addSheet(pdf,exam,student,klass); }
  else await addSheet(pdf,exam);
  const bytes=await pdf.save(); const blob=new Blob([bytes as BlobPart],{type:"application/pdf"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`${exam.name.replace(/[^a-z0-9]+/gi,"_")}_cartoes.pdf`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
