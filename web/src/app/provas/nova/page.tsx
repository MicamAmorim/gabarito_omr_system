"use client";
import { useEffect,useMemo,useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { newId } from "@/lib/storage/ids";
import { listClasses, upsertExam } from "@/lib/storage/local";
import type { AnswerLetter, ExamMode, SchoolClass } from "@/lib/types/domain";
import { ALL_LETTERS } from "@/lib/omr/layout";

export default function NewExam(){
 const router=useRouter(); const[classes,setClasses]=useState<SchoolClass[]>([]);
 const[name,setName]=useState("");const[subject,setSubject]=useState("");const[questions,setQuestions]=useState(20);const[altCount,setAltCount]=useState(5);const[maxScore,setMaxScore]=useState(10);const[mode,setMode]=useState<ExamMode>("general");const[classId,setClassId]=useState("");
 const alternatives=useMemo(()=>ALL_LETTERS.slice(0,altCount),[altCount]);
 const[key,setKey]=useState<AnswerLetter[]>(Array(20).fill("A"));
 useEffect(()=>setClasses(listClasses()),[]); useEffect(()=>setKey(k=>Array.from({length:questions},(_,i)=>k[i]??"A")),[questions]);
 function submit(){if(!name.trim()||!subject.trim())return; if(mode==="student"&&!classId)return; const id=newId("exam"); upsertExam({id,name:name.trim(),subject:subject.trim(),questions,alternatives,answerKey:key.slice(0,questions),maxScore,mode,classId:mode==="student"?classId:undefined,createdAt:new Date().toISOString()});router.push(`/provas/detalhes?id=${encodeURIComponent(id)}`)}
 return <div className="container" style={{maxWidth:900}}><div className="steps"><span className="step active"><i>1</i>Configurar</span><span>→</span><span className="step"><i>2</i>Imprimir</span><span>→</span><span className="step"><i>3</i>Corrigir</span></div><div className="eyebrow">Nova prova</div><h1 className="h1">Configure o cartão.</h1><p className="lead">O layout será gerado com quatro marcadores de alinhamento e QR de identificação.</p>
 <div className="card" style={{marginTop:24}}><div className="form"><div className="grid grid-2"><div className="field"><label>Nome da prova</label><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Teste — Função Quadrática"/></div><div className="field"><label>Disciplina</label><input className="input" value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Matemática"/></div></div>
 <div className="grid grid-3"><div className="field"><label>Questões</label><input className="input" type="number" min={1} max={60} value={questions} onChange={e=>setQuestions(Math.max(1,Math.min(60,Number(e.target.value))))}/></div><div className="field"><label>Alternativas</label><select className="select" value={altCount} onChange={e=>setAltCount(Number(e.target.value))}><option value={4}>A–D</option><option value={5}>A–E</option></select></div><div className="field"><label>Nota máxima</label><input className="input" type="number" min={1} step="0.5" value={maxScore} onChange={e=>setMaxScore(Number(e.target.value))}/></div></div>
 <div className="field"><label>Modalidade do cartão</label><div className="grid grid-2"><label className="card card-flat" style={{cursor:"pointer",borderColor:mode==="general"?"#3157d5":undefined}}><input type="radio" checked={mode==="general"} onChange={()=>setMode("general")}/> <b>Cartão geral</b><div className="list-meta">O mesmo cartão para todos. A nota aparece imediatamente após cada foto.</div></label><label className="card card-flat" style={{cursor:"pointer",borderColor:mode==="student"?"#3157d5":undefined}}><input type="radio" checked={mode==="student"} onChange={()=>setMode("student")}/> <b>Um por aluno</b><div className="list-meta">Cada cartão leva QR individual e alimenta a tabela da turma.</div></label></div></div>
 {mode==="student"&&<div className="field"><label>Turma</label>{classes.length?<select className="select" value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Selecione...</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name} — {c.students.length} alunos</option>)}</select>:<div className="callout callout-warn">Você ainda não tem turma. <Link href="/turmas/nova"><b>Cadastrar turma</b></Link>.</div>}</div>}
 <div className="field"><label>Gabarito correto</label><div className="answer-grid">{key.map((v,i)=><div className="answer-cell" key={i}><label>{i+1}</label><select value={v} onChange={e=>setKey(k=>k.map((x,j)=>j===i?e.target.value as AnswerLetter:x))}>{alternatives.map(a=><option key={a}>{a}</option>)}</select></div>)}</div></div>
 <button className="btn btn-primary btn-lg" onClick={submit} disabled={!name||!subject||(mode==="student"&&!classId)}>Criar prova e gerar cartão</button></div></div></div>
}
