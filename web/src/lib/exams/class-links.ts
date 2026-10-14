import type { Exam, SchoolClass, Student } from "@/lib/types/domain";

export function examClassIds(exam?:Exam):string[]{
  if(!exam)return [];
  const ids=exam.classIds?.length?exam.classIds:(exam.classId?[exam.classId]:[]);
  return [...new Set(ids.filter(Boolean))];
}

export function examClasses(exam:Exam|undefined,classes:SchoolClass[]):SchoolClass[]{
  const ids=new Set(examClassIds(exam));
  return classes.filter(c=>ids.has(c.id));
}

export function findExamStudent(exam:Exam,classes:SchoolClass[],studentId:string):{student:Student;klass:SchoolClass}|undefined{
  for(const klass of examClasses(exam,classes)){
    const student=klass.students.find(s=>s.id===studentId);
    if(student)return{student,klass};
  }
  return undefined;
}
