"use client";
import { useEffect,useState } from "react";
import { useRouter } from "next/navigation";
import { getClass,upsertClass } from "@/lib/storage/local";
import { newId } from "@/lib/storage/ids";
import type { SchoolClass,Student } from "@/lib/types/domain";

function norm(s:string){return s.trim().toLocaleLowerCase("pt-BR")}

export default function EditClass(){
 const router=useRouter();const[klass,setKlass]=useState<SchoolClass>();const[name,setName]=useState("");const[students,setStudents]=useState("");const[loaded,setLoaded]=useState(false);
 useEffect(()=>{const id=new URLSearchParams(location.search).get("id")??"";const k=id?getClass(id):undefined;setKlass(k);if(k){setName(k.name);setStudents(k.students.map(s=>s.name).join("\n"))}setLoaded(true)},[]);
 function save(){if(!klass)return;const names=students.split(/\n|;/).map(x=>x.trim()).filter(Boolean);if(!name.trim()||!names.length)return;const unused=[...klass.students];const next:Student[]=names.map((studentName,index)=>{let pos=unused.findIndex(s=>norm(s.name)===norm(studentName));if(pos<0&&klass.students[index])pos=unused.findIndex(s=>s.id===klass.students[index].id);if(pos>=0){const old=unused.splice(pos,1)[0];return{...old,name:studentName}}return{id:newId("stu"),name:studentName}});upsertClass({...klass,name:name.trim(),students:next});router.push("/turmas")}
 if(!loaded)return <div className="container"><div className="empty">Carregando turma...</div></div>;
 if(!klass)return <div className="container"><div className="empty"><strong>Turma não encontrada.</strong></div></div>;
 return <div className="container" style={{maxWidth:760}}><div className="eyebrow">Editar turma</div><h1 className="h1">Atualize a turma.</h1><p className="lead">Você pode renomear a turma e ajustar a lista de alunos. Sempre que possível, os identificadores dos alunos existentes são preservados.</p><div className="card" style={{marginTop:24}}><div className="form"><div className="field"><label>Nome da turma</label><input className="input" value={name} onChange={e=>setName(e.target.value)}/></div><div className="field"><label>Alunos</label><textarea className="textarea" rows={14} value={students} onChange={e=>setStudents(e.target.value)}/><small>Um aluno por linha ou separados por ponto e vírgula.</small></div><div className="toolbar"><button className="btn btn-primary btn-lg" onClick={save}>Salvar alterações</button><button className="btn btn-lg" onClick={()=>router.push("/turmas")}>Cancelar</button></div></div></div></div>
}
