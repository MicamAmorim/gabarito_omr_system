#!/usr/bin/env python3
"""Synthetic stress-test for the browser OMR geometry.
Generates canonical answer sheets, applies perspective, small rotations,
lens distortion, blur/noise/illumination, double marks and erasures.
No real student data is used.
"""
from __future__ import annotations
import json, math, os, random
from pathlib import Path
import cv2
import numpy as np

W,H=1240,1754
MARKER_SIZE=62; MARGIN=58
MARKERS=np.float32([
    [MARGIN+MARKER_SIZE/2,MARGIN+MARKER_SIZE/2],
    [W-MARGIN-MARKER_SIZE/2,MARGIN+MARKER_SIZE/2],
    [W-MARGIN-MARKER_SIZE/2,H-MARGIN-MARKER_SIZE/2],
    [MARGIN+MARKER_SIZE/2,H-MARGIN-MARKER_SIZE/2],
])
LETTERS="ABCDE"

def bubbles(n=40, alts=5):
    cols=3 if n>30 else 2 if n>15 else 1
    rows=math.ceil(n/cols); top=355; bottom=185; usable=H-top-bottom
    step=min(50, usable/max(rows,1)); colw=340; start=(W-colw*cols)/2+28
    out=[]
    for q in range(n):
        col=q//rows; row=q%rows; bx=start+col*colw; y=top+row*step
        for i in range(alts): out.append((q+1,i,int(round(bx+96+i*43)),int(round(y)),13))
    return out

def sheet(n=40, alts=5, states=None, seed=0):
    rng=random.Random(seed); im=np.full((H,W),255,np.uint8)
    for x,y in MARKERS.astype(int): cv2.rectangle(im,(x-MARKER_SIZE//2,y-MARKER_SIZE//2),(x+MARKER_SIZE//2,y+MARKER_SIZE//2),0,-1)
    qx,qy=990,190
    for yy in range(0,105,15):
        for xx in range(0,105,15):
            if rng.random()<.47: cv2.rectangle(im,(qx+xx,qy+yy),(qx+xx+10,qy+yy+10),0,-1)
    states=states or {}
    for q,i,x,y,r in bubbles(n,alts):
        cv2.circle(im,(x,y),r,45,2,cv2.LINE_AA)
        st=states.get(q)
        if st and i in st.get("marks",[]):
            kind=st.get("kind","marked")
            if kind=="rasura":
                cv2.line(im,(x-r+2,y+4),(x+r-2,y-5),35,4,cv2.LINE_AA)
                cv2.circle(im,(x+2,y),max(3,r//3),70,-1,cv2.LINE_AA)
            else:
                cv2.circle(im,(x,y),r-3,rng.randint(10,55),-1,cv2.LINE_AA)
    return im

def lens_distort(im,k1):
    h,w=im.shape[:2]
    yy,xx=np.indices((h,w),dtype=np.float32)
    cx,cy=w/2,h/2; scale=max(w,h)
    xn=(xx-cx)/scale; yn=(yy-cy)/scale; r2=xn*xn+yn*yn
    factor=1+k1*r2
    mapx=(cx+(xx-cx)/factor).astype(np.float32); mapy=(cy+(yy-cy)/factor).astype(np.float32)
    return cv2.remap(im,mapx,mapy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=245)

def degrade(im,rng):
    pad=80; src=np.float32([[0,0],[W-1,0],[W-1,H-1],[0,H-1]])
    j=lambda s:rng.uniform(-s,s)
    dst=np.float32([[pad+j(35),pad+j(45)],[W-pad+j(35),pad+j(45)],[W-pad+j(35),H-pad+j(45)],[pad+j(35),H-pad+j(45)]])
    angle=math.radians(rng.uniform(-4.5,4.5)); c=np.mean(dst,axis=0); R=np.float32([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])
    dst=(dst-c)@R.T+c
    M=cv2.getPerspectiveTransform(src,dst); out=cv2.warpPerspective(im,M,(W,H),borderValue=235)
    out=lens_distort(out,rng.uniform(-.18,.18))
    if rng.random()<.65: out=cv2.GaussianBlur(out,(3,3),rng.uniform(.4,1.1))
    yy,xx=np.indices(out.shape,dtype=np.float32); theta=rng.uniform(0,2*math.pi)
    grad=((xx/W-.5)*math.cos(theta)+(yy/H-.5)*math.sin(theta))*rng.uniform(-38,38)
    arr=np.clip(out.astype(np.float32)+grad+rng.normalvariate(0,3),0,255)
    noise=np.random.default_rng(rng.randint(0,10**9)).normal(0,rng.uniform(0,3.8),out.shape)
    return np.clip(arr+noise,0,255).astype(np.uint8)

def marker_component(im,x0,y0,x1,y1,corner):
    roi=im[y0:y1,x0:x1]; mn,mx=float(roi.min()),float(roi.max()); th=min(135,mn+(mx-mn)*.34)
    bw=(roi<th).astype(np.uint8); num,lab,stats,cent=cv2.connectedComponentsWithStats(bw,4)
    target=np.array([[0,0],[roi.shape[1],0],[roi.shape[1],roi.shape[0]],[0,roi.shape[0]]],float)[corner]
    best=None
    for i in range(1,num):
        x,y,w,h,area=stats[i];
        if area<max(30,roi.size*.001): continue
        aspect=min(w,h)/max(w,h); fill=area/(w*h)
        if aspect<.62 or fill<.50: continue
        cx,cy=cent[i]; dist=np.linalg.norm(np.array([cx,cy])-target)/math.hypot(*roi.shape[::-1]); size=math.sqrt(area)/min(roi.shape)
        score=size*2.2+fill+aspect-dist*1.1
        if best is None or score>best[0]: best=(score,(x0+cx,y0+cy))
    return None if best is None else best[1]

def detect_markers(im):
    h,w=im.shape; rx=int(w*.23); ry=int(h*.18)
    regs=[(0,0,rx,ry),(w-rx,0,w,ry),(w-rx,h-ry,w,h),(0,h-ry,rx,h)]
    pts=[marker_component(im,*r,i) for i,r in enumerate(regs)]
    if any(p is None for p in pts): raise RuntimeError("markers")
    return np.float32(pts)

def read(im,n=40,alts=5):
    pts=detect_markers(im); Hm=cv2.getPerspectiveTransform(MARKERS,pts)
    vals=[]
    for q,i,x,y,r in bubbles(n,alts):
        best_mean,best_var,best_cov=0.0,0.0,0.0
        rr=r*.48
        for oy in (-4,0,4):
            for ox in (-4,0,4):
                samples=[]
                for yy in np.arange(-rr,rr+0.1,2.5):
                    for xx in np.arange(-rr,rr+0.1,2.5):
                        if xx*xx+yy*yy>rr*rr: continue
                        p=np.array([x+ox+xx,y+oy+yy,1.0]); d=Hm@p; px,py=d[0]/d[2],d[1]/d[2]
                        ix=int(round(np.clip(px,0,W-1))); iy=int(round(np.clip(py,0,H-1))); samples.append(1-im[iy,ix]/255)
                mean=float(np.mean(samples)); var=float(np.var(samples)); cov=float((np.asarray(samples)>.45).mean())
                if mean>best_mean: best_mean,best_var,best_cov=mean,var,cov
        vals.append((q,i,best_mean,best_var,best_cov))
    arr=np.array([v[2] for v in vals]); c1,c2=float(arr.min()),float(arr.max())
    for _ in range(12):
        a=arr[np.abs(arr-c1)<np.abs(arr-c2)]; b=arr[np.abs(arr-c1)>=np.abs(arr-c2)]
        if len(a): c1=float(a.mean())
        if len(b): c2=float(b.mean())
    lo,hi=sorted([c1,c2]); th=max(.30,lo+.12) if hi-lo<.08 else max(.24,min(.55,(lo+hi)/2))
    out={}
    for q in range(1,n+1):
        qv=sorted([v for v in vals if v[0]==q],key=lambda z:z[2],reverse=True); top,second=qv[0][2],qv[1][2]
        selected=[v[1] for v in qv if v[2]>=th]
        gap=top-second; top_cov=qv[0][4]; second_cov=qv[1][4]; top_var=qv[0][3]
        if top_cov<.45 and gap<.055 and top<th*.95: state="blank"
        elif top_cov>.90 and second_cov>.90 and second>=th*.82: state="double"
        elif top_cov>.82 and top_var<.03 and gap>.075: state="marked"
        else: state="review"
        out[q]=(state, selected if selected else ([qv[0][1]] if state!="blank" else []))
    return out,th

def expected_states(n,rng):
    states={}; expected={}
    for q in range(1,n+1):
        u=rng.random(); a=rng.randrange(5)
        if u<.08: states[q]={"kind":"blank","marks":[]};expected[q]="blank"
        elif u<.15:
            b=(a+rng.randrange(1,5))%5;states[q]={"kind":"double","marks":[a,b]};expected[q]="double"
        elif u<.22: states[q]={"kind":"rasura","marks":[a]};expected[q]="review"
        else: states[q]={"kind":"marked","marks":[a]};expected[q]="marked"
    return states,expected

def main():
    cases=int(os.environ.get("OMR_CASES","180")); n=40; rng=random.Random(20261014)
    outdir=Path(__file__).parent/'out'; outdir.mkdir(exist_ok=True)
    total=correct=mark_ok=mark_total=0; failures=[]; marker_fail=0
    confusion={}
    for case in range(cases):
        states,expected=expected_states(n,rng); im=degrade(sheet(n,5,states,case),rng)
        try: got,th=read(im,n,5)
        except Exception as e:
            marker_fail+=1; failures.append({"case":case,"error":str(e)}); cv2.imwrite(str(outdir/f"fail_{case:03d}.jpg"),im); continue
        case_bad=0
        for q in range(1,n+1):
            total+=1; exp=expected[q]; pred=got[q][0]; confusion[(exp,pred)]=confusion.get((exp,pred),0)+1
            if exp==pred: correct+=1
            else: case_bad+=1
            if exp=="marked":
                mark_total+=1; actual=states[q]["marks"][0]
                if pred=="marked" and got[q][1]==[actual]: mark_ok+=1
        if case_bad>5:
            failures.append({"case":case,"misclassified":case_bad,"threshold":round(th,3)});cv2.imwrite(str(outdir/f"fail_{case:03d}.jpg"),im)
    summary={"cases":cases,"questions":total,"state_accuracy":round(correct/max(total,1),4),"normal_mark_accuracy":round(mark_ok/max(mark_total,1),4),"marker_failures":marker_fail,"saved_failure_images":len(list(outdir.glob('fail_*.jpg'))),"confusion":{f"{a}->{b}":v for (a,b),v in sorted(confusion.items())}}
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    Path(outdir/'summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    if summary["normal_mark_accuracy"]<.985 or marker_fail/cases>.02: raise SystemExit(2)

if __name__=="__main__": main()
