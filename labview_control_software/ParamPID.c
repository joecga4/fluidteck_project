/* ===========================================================================
   PARAMETROS DEL CONTROLADOR  ->  arreglo P[3] que consume el Formula Node PID
   Formula Node "ParamPID". Es el UNICO lugar donde estan los valores por
   defecto: PID no los repite (si P no llega completo, PID da FALLA y u_seguro).
   ===========================================================================

   TERMINALES
     Entradas  cod   codigo de acceso (2026 habilita los valores del panel)
               Kx    ganancia del lazo de posicion [V/mm]
               Tix   tiempo integral del lazo de posicion [s]
               Kf    correccion del lazo de fuerza [1/s]
     Salidas   P     arreglo de 3 parametros (el que lee PID.c)
               act   1 = se usan los valores del panel, 0 = valores por defecto

   P[]      significado                                 defecto   rango del panel
     P[0]   Kx   ganancia PI de posicion [V/mm]           30        1 ... 100
     P[1]   Tix  tiempo integral [s]                      1.5       0.1 ... 60
     P[2]   Kf   correccion del lazo de fuerza [1/s]      0.5       0.05 ... 5
   =========================================================================== */

float64 P[3], act;

/* valores por defecto */
P[0] = 30;
P[1] = 1.5;
P[2] = 0.5;
act = 0;

/* con el codigo de acceso, los tres salen del panel, limitados a rangos seguros */
if (cod==2026) {
    P[0] = max(1,min(100,Kx));
    P[1] = max(0.1,min(60,Tix));
    P[2] = max(0.05,min(5,Kf));
    act = 1;
}
