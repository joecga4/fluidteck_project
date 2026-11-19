/* ===========================================================================
   NODO ENTRADAS - prensa Fluidtek, VI v17
   Primer Formula Node del lazo de maquina: promedia, escala y valida las cuatro
   lecturas analogicas de cada paso.
   ===========================================================================

   TERMINALES
     Entrada   V   voltios, arreglo 2D [canal][muestra] de DAQmx Read
                   "Analog 2D DBL NChan NSamp" sobre PrensaLEDI_AI/ai0:3
                   (4 canales x 4000 muestras a 200 kS/s = 20 ms)
     Salida    M   medidas (7), para el nodo PID

   M[]  0 x   posicion del vastago [mm]            ai0, Temposonic   15 mm/V
        1 F   fuerza de la celda [kN]               ai1               20 kN/V
        2 pa  presion camara A, SIN vastago [bar]   ai2, TR44.2  (V - 1.9826)*12.5
        3 pb  presion camara B, CON vastago [bar]   ai3, TR49.2  (V - 1.9682)*50
        4 ok  1 = posicion y fuerza validas. Con 0 el PID manda u_seguro y, si
              hay ensayo, lo deja en FALLA
        5 aviso de presiones (no detiene nada mientras el corte por presiones
              este desactivado): 0 ninguno, 1 camara A, 2 camara B, 3 las dos
        6 dt  periodo del paso [s] = muestras leidas / fs

   El promedio de 20 ms es el filtro de las medidas: anula 50 Hz y sus armonicos
   y deja el ruido de posicion muy por debajo de 0.1 mm.
   =========================================================================== */

int32 i, n;
float64 fs, v0, v1, v2, v3, v_min, v_max, v_lazo;
float64 M[7];

fs     = 200000;    /* muestras/s por canal: la misma del DAQmx Timing del diagrama */
v_min  = -0.5;      /* V: por debajo, posicion o fuerza no son creibles */
v_max  = 10.5;      /* V: por encima, entrada saturada o desconectada */
v_lazo = 1.5;       /* V: un transductor 4-20 mA sano da >= 2 V; menos = lazo abierto o sin alimentar */

/* promedio de cada canal */
n = 0;
if (sizeOfDim(V,0)>=4) n = sizeOfDim(V,1);
v0=0; v1=0; v2=0; v3=0;
for (i=0; i<n; i++) {
    v0 = v0 + V[0][i];
    v1 = v1 + V[1][i];
    v2 = v2 + V[2][i];
    v3 = v3 + V[3][i];
}
if (n>0) { v0=v0/n; v1=v1/n; v2=v2/n; v3=v3/n; }

/* escalas */
M[0] = 15*v0;
M[1] = 20*v1;
M[2] = (v2-1.9826)*12.5;
M[3] = (v3-1.9682)*50;

/* validez de posicion y fuerza: hay muestras, no son NaN y estan en rango */
M[4] = 1;
if (n<1) M[4] = 0;
if (!(v0==v0) || !(v1==v1)) M[4] = 0;
if (v0<v_min || v0>v_max || v1<v_min || v1>v_max) M[4] = 0;

/* aviso de presiones: lazo abierto, saturado o NaN */
M[5] = 0;
if (!(v2==v2) || v2<v_lazo || v2>v_max) M[5] = M[5] + 1;
if (!(v3==v3) || v3<v_lazo || v3>v_max) M[5] = M[5] + 2;

/* periodo del paso: lo fija el reloj de muestreo, no el del PC */
M[6] = n/fs;
