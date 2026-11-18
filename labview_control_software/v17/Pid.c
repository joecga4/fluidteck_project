/* ===========================================================================
   NODO PID - prensa Fluidtek, VI v17 - cascada fuerza -> posicion
   Tercer Formula Node del lazo de maquina (un paso cada 20 ms):
       ENTRADAS (Entradas.c) -> M      UPH (Uph.c) -> G      panel -> C
   ===========================================================================

   QUE HACE
     1. Genera la consigna sp segun el estado st (maquina de estados).
     2. Lazo externo: convierte sp (posicion o fuerza) en consigna de posicion
        x_ref. En fuerza se divide por la rigidez estimada rig [kN/mm].
     3. Lazo interno: PI de posicion -> comando u [V] a la servovalvula.
     4. Protecciones: celda (F_corte), sobrecarga, caida de carga, limite de
        posicion, paro de emergencia (boton o seta), bomba detenida, presiones
        (desactivado), medidas invalidas y comandos incompletos.

   COMANDO SEGURO u_seguro = -0.5 V
     0 V NO es reposo: el null de la servovalvula esta en -0.37 V, y a 0 V el
     vastago se EXTIENDE ~8 mm/min mientras quede presion. Por eso el PARO, la
     bomba detenida, la medida invalida y los limites de fuerza/presion no usan
     0 V sino u_seguro, que queda por debajo del null aunque derive y retrae a
     ~3 mm/min.

   ESTADOS  st      0 reposo/aproximacion   1 carga   2 mantener   3 descarga
                    4 retorno/fin           5 FALLA
   CAUSAS   causa   0 ninguna  1 caida de carga  2 sobrecarga  3 limite de posicion
                    4 paro de emergencia (boton PARO o seta)
                    5 limite de la celda (F_corte)
                    6 bomba detenida: FALLA en ensayo, aviso en reposo
                    7 limite por presiones (pa >= pa_max o F_pres >= F_corte)
   MODOS    modo    0 control de desplazamiento [mm]    1 control de fuerza [kN]

   TERMINALES
     Entradas  M   medidas, de ENTRADAS (7)   G   UPH y seguridad, de UPH (8)
               C   comandos del panel (21)    S   estado del paso anterior (17)
               tr  reloj de alta resolucion del PC [s] (solo para medir atrasos)
     Salidas   u   comando de la servovalvula [V]
               So  estado para el paso siguiente (17)
               E   estado para la interfaz y el registro (28)

   M[]  0 x [mm]   1 F [kN]   2 pa [bar] (camara A, SIN vastago)   3 pb [bar] (camara B,
        CON vastago)   4 ok (1 = x y F validas)   5 aviso de presiones   6 dt [s]
   G[]  0 seta (1 = segura)   1 bomba en marcha (DI7)   2 orden de bomba   3 nivel
        4 filtro   5 guardamotor   6 salir   7 pasos con orden y sin marcha
   C[]  0 modo   1 iniciar   2 PARO   3 encender   4 apagar   5 salir   6 sin proteccion
        7 posicion deseada [mm]    8 fuerza deseada [kN]
        9 limite de posicion [mm]  10 limite de fuerza [kN]
        11 rampa [mm/min]          12 rampa [kN/min]         13 tiempo de carga [s]
        14 velocidad de aproximacion [mm/min]   15 Fmax fuera de ensayo [kN]
        16 codigo de acceso   17 Kx [V/mm]   18 Tix [s]   19 Kf [1/s]   20 latido
   S[] -> So[]   (llega vacio o con ceros en la primera iteracion)
        0 x_ref  1 rig   2 F_pico   3 integ   4 sp_prev   5 tr_prev
        6 F_ref  7 x_ref_rig  8 x_inicio  9 u_prev  10 modo_prev  11 causa_act
        12 st    13 f0   14 ts   15 ini_prev   16 t
   E[]  0 t  1 st  2 sp  3 F  4 x  5 x_ref  6 u  7 rig  8 dt  9 falla  10 causa
        11 prot  12 pa  13 pb  14 F_pres        (0-14: las columnas del CSV de control)
        15 seta  16 bomba en marcha  17 orden de bomba  18 nivel  19 filtro
        20 guardamotor  21 carga maxima [kN]  22 progreso [%]  23 tiempo restante [s]
        24 parametros personalizados  25 aviso de presiones  26 dt del reloj del PC [s]
        27 modo

   PARAMETROS DEL PI   Por defecto Kx = 30 V/mm, Tix = 1.5 s, Kf = 0.5 1/s. Con el
     codigo de acceso (C[16] = 2026) se usan los del panel, limitados a
     Kx 1...100, Tix 0.1...60, Kf 0.05...5.

   PARO (boton o seta) y BOMBA DETENIDA: salida u_seguro y controlador en
   seguimiento (x_ref = x) con el integrador congelado, para que al soltar el
   paro o al arrancar la bomba no haya salto. Al INICIAR un ensayo tampoco se
   toca el integrador: el comando sigue en el null aprendido.

   BASE DE TIEMPO: dt = M[6] (muestras leidas / 200 kS/s = 20 ms exactos) y t se
   acumula aqui. El reloj del PC (tr) solo sirve para ver atrasos del lazo (E[26]).

   El cuerpo (secciones 3 a 10) es el de PID.c v18 salvo el integrador, que ya no
   se pone a cero al iniciar, al cambiar de modo ni en el PARO. Con ese unico
   cambio aplicado a PID.c v18, y con seta = 1 y bomba en marcha, los dos dan
   exactamente lo mismo (pruebas/arnes_v17.js).
   =========================================================================== */


/* ---------------------------------------------------------------------------
   0. DECLARACIONES Y CONSTANTES
   (el Formula Node no tiene #define: las constantes son variables)
   --------------------------------------------------------------------------- */

/* medidas (M), seguridad (G) y comandos (C) */
float64 x, F, pa, pb, ok, aviso;
float64 seta, uph;
float64 modo, ini, paro, sinprot, spm, lim, rate, tc, xlim, vjog, Flib;
/* parametros del PI y ajustes */
float64 Kx, Tix, Kf, act, rig_ini, frac_caida, frac_sobre, v_retorno, du_max, par_ok;
/* estado persistente (S) */
float64 x_ref, rig, F_pico, integ, sp_prev, t_prev, F_ref, x_ref_rig, x_inicio;
float64 u_prev, modo_prev, causa_act;
float64 stp, f0p, tsp, inip, t;
/* resultado del paso */
float64 st, f0, ts, sp, prot, prog, trest, falla, causa;
/* variables de trabajo */
float64 med, dt, dt_real, v_aprox, F_lib, en_paro;
float64 dif, vel_sp, dF_min, rig_nueva;
float64 x_ref_ini, err;
float64 F_pres, lim_pres;
/* arreglos de salida */
float64 So[17];
float64 E[28];
/* constantes de seguridad y de ajuste */
float64 F_corte, pa_max, prot_pres_on, v_des, u_max, u_seguro, x_win, v_lenta;
float64 rig_min, rig_max, alfa_rig, frac_freno, frac_pico_min, margen_xlim;
float64 dF_min_rig, dx_min_rig, dx_sin_contacto;
float64 cFpA, cFpB;
/* codigos de estado y de causa */
float64 ST_REPOSO, ST_CARGA, ST_MANTIENE, ST_DESCARGA, ST_RETORNO, ST_FALLA;
float64 CAU_NINGUNA, CAU_CAIDA, CAU_SOBRECARGA, CAU_LIM_POS, CAU_PARO, CAU_FCORTE, CAU_BOMBA, CAU_PRESION;

F_corte  = 160;     /* kN: corte por la celda. 160 kN ~ 80 bar con el cilindro 160/80: BAJAR (CLAUDE.md 6) */
pa_max   = 95;      /* bar: corte por presion de la camara A (el TR44.2 satura a 100 bar) */
prot_pres_on = 0;   /* 0 = corte por presiones DESACTIVADO (desde 2026-11-03); 1 = activo */
v_des    = 40;      /* kN/min: carga/descarga en fuerza fuera de ensayo y descarga en ensayo */
u_max    = 10;      /* V: saturacion del comando (tambien umbral del anti-windup) */
u_seguro = -0.5;    /* V: comando seguro (retrae ~3 mm/min). 0 V extiende: el null esta en -0.37 V */
x_win    = 2;       /* mm: x_ref no se separa de x mas que esto */
v_lenta  = 2;       /* mm/min: avance lento fuera de ensayo con compresion */
rig_min  = 0.02;    /* kN/mm: rigidez estimada minima */
rig_max  = 50;      /* kN/mm: rigidez estimada maxima */
alfa_rig = 0.3;     /* filtro de la rigidez estimada */
frac_freno    = 0.25;   /* avance lento si F > frac_freno*F_lib (fuera de ensayo) */
frac_pico_min = 0.2;    /* la caida de carga solo cuenta si el pico fue > 20 % de lim */
margen_xlim   = 0.5;    /* mm: tolerancia sobre el limite de posicion xlim */
dF_min_rig      = 0.05; /* kN: cambio minimo de fuerza para actualizar la rigidez */
dx_min_rig      = 0.002;/* mm: cambio minimo de posicion para actualizar la rigidez */
dx_sin_contacto = 5;    /* mm: mas que esto sin cambio de F = sin contacto */
rig_ini      = 1;       /* kN/mm: rigidez inicial estimada */
frac_caida   = 0.3;     /* caida de carga que dispara FALLA (fraccion del pico) */
frac_sobre   = 1.2;     /* sobrecarga que dispara FALLA (fraccion de lim) */
v_retorno    = 50;      /* mm/min: velocidad de retorno, todos los casos y modos */
du_max       = 40;      /* V/s: variacion maxima de la salida u */

/* Fp = A_A*pa - A_B*pb con el cilindro 160/80 mm (kN/bar = A[m2]*100):
   A_A = 201.06 cm2 (camara A, sin vastago), A_B = 150.80 cm2 (camara B, con vastago) */
cFpA = 2.0106;
cFpB = 1.5080;

ST_REPOSO = 0;  ST_CARGA = 1;  ST_MANTIENE = 2;  ST_DESCARGA = 3;  ST_RETORNO = 4;  ST_FALLA = 5;
CAU_NINGUNA = 0;  CAU_CAIDA = 1;  CAU_SOBRECARGA = 2;  CAU_LIM_POS = 3;
CAU_PARO = 4;  CAU_FCORTE = 5;  CAU_BOMBA = 6;  CAU_PRESION = 7;

/* ---------------------------------------------------------------------------
   0b. ENTRADAS: de los arreglos a variables con nombre
   Si falta algun arreglo los valores son inertes y la seccion 12 deja el paso
   en FALLA con u = u_seguro.
   --------------------------------------------------------------------------- */

/* medidas */
x=0; F=0; pa=0; pb=0; ok=0; aviso=0; dt=0;
if (sizeOfDim(M,0)>=7) {
    x=M[0]; F=M[1]; pa=M[2]; pb=M[3]; ok=M[4]; aviso=M[5]; dt=M[6];
}
if (dt<=0 || dt>1) dt = 0.02;   /* sin medidas validas: periodo nominal */

/* seguridad: sin datos de la UPH, seta pulsada y bomba detenida */
seta=0; uph=0;
if (sizeOfDim(G,0)>=7) { seta=G[0]; uph=G[1]; }

/* comandos del panel. La consigna manual, la consigna final y la rampa dependen
   del tipo de control */
par_ok = sizeOfDim(C,0)>=20;
modo=0; ini=0; paro=1; sinprot=0; spm=0; lim=0; rate=0; tc=0; xlim=0; vjog=0; Flib=0;
Kx=0; Tix=1; Kf=0; act=0;
if (par_ok) {
    modo=C[0]; ini=C[1]; paro=C[2]; sinprot=C[6];
    if (modo>0.5) { spm=C[8]; lim=C[10]; rate=C[12]; }
    else          { spm=C[7]; lim=C[9];  rate=C[11]; }
    xlim=C[9]; tc=C[13]; vjog=C[14]; Flib=C[15];
    /* parametros del PI: por defecto, o los del panel con el codigo de acceso */
    Kx=30; Tix=1.5; Kf=0.5;
    if (C[16]==2026) {
        Kx  = max(1,min(100,C[17]));
        Tix = max(0.1,min(60,C[18]));
        Kf  = max(0.05,min(5,C[19]));
        act = 1;
    }
}

/* ---------------------------------------------------------------------------
   1. MEDICION ACTUAL Y ESTADO PERSISTENTE
   --------------------------------------------------------------------------- */

/* medicion del modo activo: posicion [mm] o fuerza [kN] */
med = x;
if (modo>0.5) med = F;

/* el estado llega vacio o con ceros en la primera iteracion: rig>0 indica estado valido */
if (sizeOfDim(S,0)>=17 && S[1]>0) {
    x_ref=S[0]; rig=S[1]; F_pico=S[2]; integ=S[3]; sp_prev=S[4]; t_prev=S[5];
    F_ref=S[6]; x_ref_rig=S[7]; x_inicio=S[8]; u_prev=S[9]; modo_prev=S[10]; causa_act=S[11];
} else {
    x_ref=x; rig=rig_ini; F_pico=0; integ=0; sp_prev=med; t_prev=tr;
    F_ref=F; x_ref_rig=x; x_inicio=x; u_prev=0; modo_prev=modo; causa_act=0;
}

dt_real = tr - t_prev;   /* periodo medido con el reloj del PC: solo diagnostico */

/* estado del ensayo y reloj: se conservan aunque el resto del estado se reinicie */
stp=0; f0p=0; tsp=0; inip=0; t=0;
if (sizeOfDim(S,0)>=17) { stp=S[12]; f0p=S[13]; tsp=S[14]; inip=S[15]; t=S[16]; }
t = t + dt;
if (ini>0.5 && inip<0.5) t = dt;   /* el reloj del ensayo empieza con INICIAR */

x_ref_ini = x_ref;   /* x_ref al empezar el paso (la proteccion de fuerza lo restituye) */
prot = 0;
st = stp;  f0 = f0p;  ts = tsp;

/* ---------------------------------------------------------------------------
   2. MAGNITUDES DERIVADAS Y LIMITES
   --------------------------------------------------------------------------- */

/* paro efectivo: boton PARO del panel o seta de emergencia pulsada */
en_paro = 0;
if (paro>0.5 || seta<0.5) en_paro = 1;

/* fuerza estimada por las presiones [kN] y corte por presiones (hoy desactivado) */
F_pres = cFpA*pa - cFpB*pb;
lim_pres = 0;
if (prot_pres_on>0.5 && (pa>=pa_max || F_pres>=F_corte)) lim_pres = 1;

/* velocidad de aproximacion [mm/min] y limite de fuerza fuera de ensayo [kN] */
v_aprox = vjog;
if (v_aprox<=0) v_aprox = 25;
v_aprox = min(50,v_aprox);

F_lib = abs(Flib);
if (F_lib<=0) F_lib = 4;
F_lib = max(0.2,min(50,F_lib));

/* ---------------------------------------------------------------------------
   3. INICIO DEL ENSAYO
   El ensayo arranca en el flanco de subida de INICIAR (ini = 1, inip = 0).
   --------------------------------------------------------------------------- */

/* reinicio sin salto al iniciar o al cambiar el tipo de control: la referencia se
   iguala a la posicion y el integrador SE CONSERVA (guarda el null aprendido), asi
   el comando sigue donde estaba. Ponerlo a cero mandaba 0 V durante 0.1-0.4 s */
if ((ini>0.5 && inip<0.5) || modo!=modo_prev) {
    x_ref = x;
    sp_prev = med;
}

/* ---------------------------------------------------------------------------
   4. GENERADOR DE CONSIGNA sp (maquina de estados)
   --------------------------------------------------------------------------- */
if (ini<0.5) {
    /* FUERA DE ENSAYO: avance a v_aprox, retorno a v_retorno. Lento solo si se
       avanza con compresion (F > frac_freno*F_lib); el retorno nunca se frena.
       En fuerza, la consigna spm se limita a +-F_lib (o +-F_corte si sinprot). */
    st = ST_REPOSO;
    causa_act = CAU_NINGUNA;
    if (modo>0.5) {
        if (sinprot>0.5) {
            dif = max(-F_corte,min(F_corte,spm)) - sp_prev;
        } else {
            dif = max(-F_lib,min(F_lib,spm)) - sp_prev;
        }
        vel_sp = v_des;
    } else {
        dif = spm - sp_prev;
        vel_sp = v_aprox;
        if (dif<0) vel_sp = v_retorno;
        if (sinprot<0.5 && dif>0 && F>frac_freno*F_lib) vel_sp = min(v_aprox,v_lenta);
    }
    /* la consigna sigue a spm con pendiente limitada a vel_sp [unidad/min] */
    sp = sp_prev + max(-vel_sp*dt/60,min(vel_sp*dt/60,dif));
} else {
    /* EN ENSAYO */
    if (inip<0.5) {
        /* primer paso del ensayo: arranca la carga desde la medicion actual */
        st = ST_CARGA;
        f0 = med;
        ts = t;
        F_pico = 0;
        F_ref = F;
        x_ref_rig = x;
        x_inicio = x;
        causa_act = CAU_NINGUNA;
    }
    dif = lim - f0;
    if (st==ST_CARGA) {
        /* carga: rampa hacia lim */
        sp = f0 + sign(dif)*abs(rate)*(t-ts)/60;
        if (dif*(sp-lim)>=0) { sp=lim; st=ST_MANTIENE; ts=t; }
    } else if (st==ST_MANTIENE) {
        /* mantener lim durante tc segundos */
        sp = lim;
        if (t-ts>=tc) { st=ST_DESCARGA; ts=t; }
    } else if (st==ST_DESCARGA) {
        /* descarga: a v_retorno [mm/min] en desplazamiento, a v_des [kN/min] en fuerza */
        vel_sp = v_des;
        if (modo<0.5) vel_sp = v_retorno;
        sp = lim - sign(dif)*vel_sp*(t-ts)/60;
        if (dif*(f0-sp)>=0) { sp=f0; st=ST_RETORNO; ts=t; }
    } else {
        /* retorno/fin (4) o FALLA (5): consigna en el valor inicial */
        sp = f0;
    }
}

/* ---------------------------------------------------------------------------
   5. RIGIDEZ ESTIMADA rig = dF/dx
   En linea en todo momento salvo retorno y falla (reposo, aproximacion, carga,
   mantenimiento y descarga, en ambos modos): asi el lazo de fuerza usa la
   rigidez real.
   --------------------------------------------------------------------------- */
dF_min = dF_min_rig;
if (ini>0.5) dF_min = max(dF_min_rig,dF_min_rig*abs(lim-f0));
if (st<=ST_DESCARGA && abs(F-F_ref)>dF_min && abs(x-x_ref_rig)>dx_min_rig) {
    rig_nueva = (F-F_ref)/(x-x_ref_rig);
    if (rig_nueva>rig_min) rig = rig + alfa_rig*(rig_nueva-rig);
    F_ref = F;
    x_ref_rig = x;
}
if (abs(x-x_ref_rig)>dx_sin_contacto) { F_ref=F; x_ref_rig=x; }   /* sin contacto: reinicia la referencia */
rig = max(rig_min,min(rig_max,rig));


/* ---------------------------------------------------------------------------
   6. LAZO EXTERNO: consigna de posicion x_ref
   --------------------------------------------------------------------------- */
if (modo>0.5) {
    /* control de fuerza */
    if (st==ST_RETORNO) {
        /* retorno a la posicion inicial x_inicio a v_retorno */
        x_ref = x_ref + sign(x_inicio-x_ref)*min(abs(x_inicio-x_ref),v_retorno*dt/60);
    } else if (st!=ST_FALLA) {
        /* avance de x_ref en este paso: prealimentacion de la rampa + correccion
           normalizada por rigidez, limitado a v_aprox (evita embalarse sin contacto) */
        x_ref = x_ref + max(-v_aprox*dt/60,min(v_aprox*dt/60,(sp-sp_prev)/rig + Kf*(sp-F)/rig*dt));
    }
} else {
    /* control de desplazamiento */
    if (st!=ST_FALLA) x_ref = sp;
}


/* ---------------------------------------------------------------------------
   7. PROTECCION DE FUERZA FUERA DE ENSAYO
   Con compresion F > F_lib no deja avanzar; retroceder (alejarse) siempre esta
   permitido.
   --------------------------------------------------------------------------- */
if (st==ST_REPOSO && sinprot<0.5) {
    if (F>F_lib) { x_ref=min(x_ref,x_ref_ini); integ=min(integ,0); prot=1; }
    if (prot>0.5 && modo<0.5) sp = x_ref;
}


/* ---------------------------------------------------------------------------
   8. DETECCION DE FALLA, LIMITES Y PARO DE EMERGENCIA
   --------------------------------------------------------------------------- */
if (st>=ST_CARGA && st<=ST_DESCARGA) {
    F_pico = max(F_pico,F);
    if (modo>0.5 && st<=ST_MANTIENE && F_pico>frac_pico_min*abs(lim) && F<(1-frac_caida)*F_pico) {
        st=ST_FALLA; causa_act=CAU_CAIDA; x_ref=x;           /* caida de carga */
    } else if (modo>0.5 && F>frac_sobre*abs(lim)) {
        st=ST_FALLA; causa_act=CAU_SOBRECARGA; x_ref=x;      /* sobrecarga */
    } else if (x>xlim+margen_xlim) {
        st=ST_FALLA; causa_act=CAU_LIM_POS; x_ref=x;         /* limite de posicion */
    }
}
/* limite del sistema: en ensayo se declara FALLA */
if (st>=ST_CARGA && st<=ST_RETORNO && abs(F)>=F_corte) { st=ST_FALLA; causa_act=CAU_FCORTE;  x_ref=x; }
if (st>=ST_CARGA && st<=ST_RETORNO && lim_pres>0.5)    { st=ST_FALLA; causa_act=CAU_PRESION; x_ref=x; }
/* bomba detenida durante el ensayo: FALLA (si la paro la seta o el PARO, manda esa causa) */
if (st>=ST_CARGA && st<=ST_RETORNO && uph<0.5)         { st=ST_FALLA; causa_act=CAU_BOMBA;   x_ref=x; }
if (en_paro>0.5 && ini>0.5)  { st=ST_FALLA; causa_act=CAU_PARO; }
if (st==ST_FALLA) sp = med;
if (modo>0.5) sp = max(-F_corte,min(F_corte,sp));   /* consigna de fuerza nunca sobre el corte */


/* ---------------------------------------------------------------------------
   9. LAZO INTERNO DE POSICION (PI con anti-windup) Y SEGURIDADES DE SALIDA
   --------------------------------------------------------------------------- */
x_ref = max(x-x_win,min(x+x_win,x_ref));
err = x_ref - x;
u = Kx*(err+integ/Tix);
/* integra solo si no satura y si de verdad esta controlando (ni paro ni bomba detenida) */
if (abs(u)<u_max && en_paro<0.5 && uph>0.5) integ = integ + err*dt;
u = max(-u_max,min(u_max,u));
u = max(u_prev-du_max*dt,min(u_prev+du_max*dt,u));           /* limite de variacion (V/s) */

/* LIMITE DEL SISTEMA: desde F_corte no se permite empujar mas, en cualquier estado y modo.
   "No empujar" es u <= u_seguro: con 0 V el vastago seguiria extendiendose */
if (F>=F_corte)  { u=min(u,u_seguro); integ=min(integ,0); x_ref=min(x_ref,x); prot=1; }
if (F<=-F_corte) { u=max(u,0); integ=max(integ,0); x_ref=max(x_ref,x); prot=1; }
/* corte por presiones (solo si prot_pres_on = 1) */
if (lim_pres>0.5) { u=min(u,u_seguro); integ=min(integ,0); x_ref=min(x_ref,x); prot=1; }
/* PARO o BOMBA DETENIDA: comando seguro y seguimiento, con el integrador congelado,
   para que no haya salto al soltar el paro ni al arrancar la bomba (sin esto, con
   la bomba parada el PI se iria a +-10 V y la valvula estaria abierta del todo en
   el arranque) */
if (en_paro>0.5 || uph<0.5) { u=u_seguro; x_ref=x; sp=med; }


/* ---------------------------------------------------------------------------
   10. INDICADORES PARA LA INTERFAZ
   --------------------------------------------------------------------------- */
prog = 0;
trest = 0;
if (st==ST_MANTIENE) {
    if (tc>0) prog = 100*min(1,(t-ts)/tc);
    trest = max(0,tc-(t-ts));
}
if (st==ST_DESCARGA || st==ST_RETORNO) prog = 100;
falla = 0;
if (st==ST_FALLA) falla = 1;
causa = causa_act;
if (uph<0.5 && st!=ST_FALLA) causa = CAU_BOMBA;   /* aviso sin falla: por que no hay movimiento */
if (en_paro>0.5) { causa=CAU_PARO; falla=1; }     /* alarma de PARO tambien fuera de ensayo */


/* ---------------------------------------------------------------------------
   11. ESTADO PARA EL SIGUIENTE PASO Y ESTADO PARA LA INTERFAZ Y EL REGISTRO
   --------------------------------------------------------------------------- */
sp_prev = sp;
u_prev = u;
t_prev = tr;      /* reloj del PC del paso (para dt_real) */
modo_prev = modo;

So[0]=x_ref;  So[1]=rig;       So[2]=F_pico;  So[3]=integ;     So[4]=sp_prev; So[5]=t_prev;
So[6]=F_ref;  So[7]=x_ref_rig; So[8]=x_inicio; So[9]=u_prev;   So[10]=modo_prev; So[11]=causa_act;
So[12]=st;    So[13]=f0;       So[14]=ts;      So[15]=ini;      So[16]=t;

E[0]=t;    E[1]=st;   E[2]=sp;   E[3]=F;   E[4]=x;   E[5]=x_ref;
E[6]=u;    E[7]=rig;  E[8]=dt;   E[9]=falla; E[10]=causa; E[11]=prot;
E[12]=pa;  E[13]=pb;  E[14]=F_pres;
E[15]=seta;   E[16]=uph;    E[17]=0;      E[18]=0;     E[19]=0;   E[20]=0;
if (sizeOfDim(G,0)>=7) { E[17]=G[2]; E[18]=G[3]; E[19]=G[4]; E[20]=G[5]; }
E[21]=F_pico; E[22]=prog;   E[23]=trest;  E[24]=act;   E[25]=aviso;
E[26]=dt_real; E[27]=modo;


/* ---------------------------------------------------------------------------
   12. PROTECCION ANTE DATOS INVALIDOS
   Medida invalida (ok = 0 o NaN en posicion o fuerza) o comandos incompletos:
   salida u_seguro, FALLA en ensayo y reinicio del estado (So[1]=0 hace que el
   proximo paso lo descarte).
   --------------------------------------------------------------------------- */
if (!(x==x) || !(F==F) || ok<0.5 || par_ok<0.5) {
    u = u_seguro;
    falla = 1;
    So[1] = 0;
    if (st>=ST_CARGA && st<=ST_RETORNO) st = ST_FALLA;
    So[12] = st;
    E[1] = st;
    E[6] = u;
    E[9] = 1;
}
