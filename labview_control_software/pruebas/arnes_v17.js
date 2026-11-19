// Pruebas de los Formula Node de la VI v17 (v17\Entradas.c, v17\Uph.c, v17\Pid.c) con el motor
// JScript de Windows. Ejecutar desde labview_control_software:
//
//   cscript //nologo pruebas\arnes_v17.js todo [N]      todas las pruebas (N pasos; por defecto 100000)
//   cscript //nologo pruebas\arnes_v17.js mutantes [N]  comprueba que las pruebas detectan errores puestos a proposito
//   cscript //nologo pruebas\arnes_v17.js trayecto      cadena completa en lazo cerrado frente a la v16 (PID.c v18)
//
// Que se comprueba:
//   PID   Pid.c da lo mismo que PID.c v18 + ParamPID.c con seta = 1 y bomba en marcha (paso a paso,
//         con entradas y estado aleatorios, con y sin corte por presiones), una vez aplicado a la
//         v18 el unico cambio del cuerpo: el integrador ya no se pone a cero al iniciar, al cambiar
//         de modo ni en el PARO (funcion sinReinicioDelIntegrador). Seta pulsada equivale a PARO;
//         bomba detenida = comando seguro y seguimiento, FALLA con causa 6 en ensayo; en paro o con
//         la bomba detenida el integrador no cambia; al iniciar un ensayo el comando no salta.
//   UPH   tabla de verdad completa frente a la logica cableada de la v16; solo debe cambiar el caso
//         Encender + apagado en el mismo paso (ahora manda el apagado).
//   ENTRADAS  promedios y escalas frente a un calculo independiente; validez y avisos.
var fso = new ActiveXObject("Scripting.FileSystemObject");
function lee(ruta) { var f = fso.OpenTextFile(ruta, 1); var s = f.ReadAll(); f.Close(); return s; }
var DIR = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));   // labview_control_software

// ---- funciones del Formula Node
function min(a, b) { return Math.min(a, b); }
function max(a, b) { return Math.max(a, b); }
function abs(a) { return Math.abs(a); }
function sign(a) { return a > 0 ? 1 : (a < 0 ? -1 : 0); }
function sizeOfDim(a, d) { if (d == 0) return a.length; return a.length ? a[0].length : 0; }
function ceros(n) { var a = []; for (var i = 0; i < n; i++) a[i] = 0; return a; }

// compila(texto, entradas, salidas): salidas escalares y arreglos (los arreglos se declaran en el texto)
function compila(txt, ents, sals, presOn) {
    txt = txt.replace(/\r/g, '');
    if (presOn) {
        if (!/prot_pres_on\s*=\s*0;/.test(txt)) throw new Error('no encuentro prot_pres_on = 0');
        txt = txt.replace(/prot_pres_on\s*=\s*0;/, 'prot_pres_on = 1;');
    }
    // declaraciones: "float64 a, b[3];" -> "var a, b = ceros(3);"
    txt = txt.replace(/(float64|int32)\s+([^;]+);/g, function (m, ty, lista) {
        var it = lista.split(','), out = [], j;
        for (j = 0; j < it.length; j++) {
            var q = /^\s*(\w+)\s*\[(\d+)\]\s*$/.exec(it[j]);
            out.push(q ? q[1] + ' = ceros(' + q[2] + ')' : it[j].replace(/^\s+|\s+$/g, ''));
        }
        return 'var ' + out.join(', ') + ';';
    });
    var decl = [], post = '\nreturn {', i;
    for (i = 0; i < sals.length; i++) {
        post += (i ? ',' : '') + sals[i] + ':' + sals[i];
        if (!new RegExp('var [^;]*\\b' + sals[i] + '\\b').test(txt)) decl.push(sals[i]);
    }
    post += '};';
    var args = ents.slice(0); args.push((decl.length ? 'var ' + decl.join(',') + ';\n' : '') + txt + post);
    return Function.apply(null, args);
}
var ENT_V = ['x','F','modo','t','tr','pa','pb','vjog','Flib','sinprot','ini','inip','spm','lim','rate','tc','xlim','paro','stp','f0p','tsp','P','S'];
var SAL_V = ['st','f0','ts','inio','sp','prot','prog','trest','falla','causa','Fpko','xspo','kho','u','So','Lg'];
function viejo(f, e) { return f(e.x,e.F,e.modo,e.t,e.tr,e.pa,e.pb,e.vjog,e.Flib,e.sinprot,e.ini,e.inip,e.spm,e.lim,e.rate,e.tc,e.xlim,e.paro,e.stp,e.f0p,e.tsp,e.P,e.S); }

// ---- aleatorio reproducible (Park-Miller)
var semilla = 12345;
function rnd() { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; }
function U(a, b) { return a + (b - a) * rnd(); }
function elige(a) { return a[Math.floor(rnd() * a.length)]; }
function igual(a, b) {
    a = Number(a); b = Number(b);
    if (a !== a && b !== b) return true;
    if (a === b) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

// =====================================================================================
// PID
// =====================================================================================
// PID.c v18 con el unico cambio de cuerpo que lleva Pid.c: no reiniciar el integrador.
function sinReinicioDelIntegrador(txt) {
    var cambios = [
        ['    x_ref = x;\n    integ = 0;\n    sp_prev = med;', '    x_ref = x;\n    sp_prev = med;'],
        ['if (abs(u)<u_max) integ = integ + err*dt;', 'if (abs(u)<u_max && paro<0.5) integ = integ + err*dt;'],
        ['if (paro>0.5) { u=u_seguro; integ=0; x_ref=x; sp=med; }', 'if (paro>0.5) { u=u_seguro; x_ref=x; sp=med; }']
    ], i;
    txt = txt.replace(/\r/g, '');
    for (i = 0; i < cambios.length; i++) {
        if (txt.indexOf(cambios[i][0]) < 0) throw new Error('PID.c v18 no contiene: ' + cambios[i][0]);
        txt = txt.replace(cambios[i][0], cambios[i][1]);
    }
    return txt;
}
// Un caso: entradas del nodo nuevo (M, G, C, S, tr) y las equivalentes del nodo viejo.
function casoPid(fPar) {
    var n = {}, v = {}, r;
    var modo = rnd() < 0.5 ? 0 : 1, x = U(0, 150), F;
    r = rnd();
    if (r < 0.60) F = U(-2, 60); else if (r < 0.72) F = U(0, 6); else if (r < 0.88) F = U(120, 200);
    else if (r < 0.93) F = U(-200, -120); else F = U(155, 165);
    var ok = 1;
    if (rnd() < 0.004) { x = NaN; ok = 0; }
    if (rnd() < 0.004) { F = NaN; ok = rnd() < 0.5 ? 0 : 1; }
    var soloOk = false;
    if (rnd() < 0.003 && ok == 1) { ok = 0; soloOk = (x === x) && (F === F); }   // medida marcada como invalida por ENTRADAS
    var pa = rnd() < 0.85 ? U(0, 80) : U(80, 120), pb = U(0, 150);
    var ini = rnd() < 0.6 ? 1 : 0;
    var inip = ini ? (rnd() < 0.9 ? 1 : 0) : (rnd() < 0.2 ? 1 : 0);
    var cod = elige([0, 0, 2026, 2026, 1234]), Kx = U(0, 150), Tix = U(0, 80), Kf = U(0, 8);
    var C = [modo, ini, rnd() < 0.06 ? 1 : 0, 0, 0, 0, rnd() < 0.2 ? 1 : 0,
             U(0, 150), U(-10, 200), U(20, 150), U(0, 200),
             elige([U(0.05, 100), -U(0.05, 100), 0.1, 1.5]), elige([U(0.05, 100), -U(0.05, 100), 10]),
             rnd() < 0.2 ? 0 : U(0, 60), elige([0, -5, 25, 50, 80, U(1, 60)]), elige([0, 1, 4, -3, 100, U(0.1, 60)]),
             cod, Kx, Tix, Kf, 0];
    var Ccorto = rnd() < 0.015;
    var tr = U(10, 1e5), dt = rnd() < 0.9 ? U(0.015, 0.03) : elige([0, -1, 2, 0.5]);
    var med = modo > 0.5 ? F : x, stp = Math.floor(rnd() * 6), t0 = U(0, 2000);
    var f0p = modo > 0.5 ? U(0, 60) : U(0, 150), tsp = t0 - U(0, 100);
    var S12 = [x + U(-3, 3), Math.exp(U(Math.log(0.02), Math.log(50))), rnd() < 0.3 ? 0 : U(0, 200), U(-0.5, 0.5),
               med + U(-2, 2), tr - U(0.015, 0.03), F + U(-3, 3), x + U(-6, 6), U(0, 150), U(-10, 10),
               rnd() < 0.95 ? modo : 1 - modo, Math.floor(rnd() * 8)];
    r = rnd();
    var S, Sv;
    if (r < 0.05) { S = ceros(17); Sv = ceros(12); stp = 0; f0p = 0; tsp = 0; inip = 0; t0 = 0; }   // primera iteracion
    else if (r < 0.07) { S = ceros(5); Sv = ceros(5); stp = 0; f0p = 0; tsp = 0; inip = 0; t0 = 0; }  // estado corto
    else {
        if (r < 0.12) S12[1] = 0;                                   // estado reiniciado tras un dato invalido
        S = S12.concat([stp, f0p, tsp, inip, t0]); Sv = S12.slice(0);
    }
    var dtv = dt; if (dtv <= 0 || dtv > 1) dtv = 0.02;              // lo que el nodo nuevo usara como dt
    n.M = [x, F, pa, pb, ok, 0, dt]; n.G = [1, 1, 1, 1, 1, 0, 0, 0]; n.C = Ccorto ? C.slice(0, 10) : C; n.S = S; n.tr = tr;
    // equivalentes del nodo viejo
    var P = Ccorto ? { P: [30, 1.5], act: 0 } : fPar(cod, Kx, Tix, Kf);
    v.x = x; v.F = F; v.modo = Ccorto ? 0 : modo; v.pa = pa; v.pb = pb; v.tr = tr;
    v.S = Sv.slice(0);
    if (v.S.length >= 12 && v.S[1] > 0) v.S[5] = tr - dtv;          // el viejo saca dt del reloj del PC
    v.dtViejoIgual = !(v.S.length >= 12 && v.S[1] > 0) ? (dtv == 0.02) : true;
    if (!v.dtViejoIgual) { n.M[6] = 0.02; dtv = 0.02; }             // estado sin validar: el viejo usa 0.02
    v.ini = Ccorto ? 0 : 10 * ini; v.inip = 10 * inip;
    v.t = ((Ccorto ? 0 : ini) > 0.5 && inip < 0.5) ? dtv : t0 + dtv;
    v.paro = Ccorto ? 1 : C[2]; v.sinprot = Ccorto ? 0 : C[6];
    v.spm = Ccorto ? 0 : (modo > 0.5 ? C[8] : C[7]); v.lim = Ccorto ? 0 : (modo > 0.5 ? C[10] : C[9]);
    v.rate = Ccorto ? 0 : (modo > 0.5 ? C[12] : C[11]); v.xlim = Ccorto ? 0 : C[9];
    v.tc = Ccorto ? 0 : C[13]; v.vjog = Ccorto ? 0 : C[14]; v.Flib = Ccorto ? 0 : C[15];
    v.stp = stp; v.f0p = f0p; v.tsp = tsp; v.P = P.P; v.act = Ccorto ? 0 : P.act;
    return { n: n, v: v, malo: (x !== x) || (F !== F) || ok < 0.5 || Ccorto, soloOk: soloOk };
}
// Lo que debe dar el nodo nuevo, escrito a partir de la salida del viejo.
function esperadoDeViejo(o, c) {
    var e = { u: o.u, So: o.So.slice(0), E: o.Lg.slice(0) };
    e.So[12] = o.st; e.So[13] = o.f0; e.So[14] = o.ts; e.So[15] = o.inio / 10; e.So[16] = c.v.t;
    e.E[0] = c.v.t; e.E[1] = o.st;
    e.E[15] = 1; e.E[16] = 1; e.E[17] = 1; e.E[18] = 1; e.E[19] = 1; e.E[20] = 0;
    e.E[21] = o.Fpko; e.E[22] = o.prog; e.E[23] = o.trest; e.E[24] = c.v.act; e.E[25] = 0;
    e.E[26] = null; e.E[27] = c.v.modo;                                // E[26] (dt del reloj del PC) no se compara
    return e;
}
function difs(esp, o) {
    var d = [], i;
    if (!igual(esp.u, o.u)) d.push('u: ' + esp.u + ' / ' + o.u);
    for (i = 0; i < 17; i++) if (!igual(esp.So[i], o.So[i])) d.push('So[' + i + ']: ' + esp.So[i] + ' / ' + o.So[i]);
    for (i = 0; i < 28; i++) if (esp.E[i] !== null && !igual(esp.E[i], o.E[i])) d.push('E[' + i + ']: ' + esp.E[i] + ' / ' + o.E[i]);
    return d;
}
function copia(o) { return { u: o.u, So: o.So.slice(0), E: o.E.slice(0) }; }
function con(n, cambios) {        // copia de las entradas del nodo nuevo con C[2] (paro), G[0] (seta) o G[1] (bomba) cambiados
    var m = { M: n.M, G: n.G.slice(0), C: n.C.slice(0), S: n.S, tr: n.tr };
    if (cambios.paro !== undefined && m.C.length > 2) m.C[2] = cambios.paro;
    if (cambios.seta !== undefined) m.G[0] = cambios.seta;
    if (cambios.uph !== undefined) m.G[1] = cambios.uph;
    return m;
}
function pid(f, n) { return f(n.M, n.G, n.C, n.S, n.tr); }

function pruebaPid(tPid, tViejo, tPar, N, presOn, verboso) {
    var fN = compila(tPid, ['M', 'G', 'C', 'S', 'tr'], ['u', 'So', 'E'], presOn);
    var fV = compila(sinReinicioDelIntegrador(tViejo), ENT_V, SAL_V, presOn);
    var fP0 = compila(tPar, ['cod', 'Kx', 'Tix', 'Kf'], ['P', 'act'], 0);
    var fPar = function (cod, Kx, Tix, Kf) { return fP0(cod, Kx, Tix, Kf); };
    var r = { igual: 0, seta: 0, bomba: 0, integ: 0, inicios: 0, casos: N, falla6: 0, aviso6: 0 }, k, d, mostrados = 0;
    function anota(que, k, d, c) {
        r[que]++;
        if (verboso && mostrados < 6) { mostrados++; WScript.Echo('    FALLO ' + que + ' paso ' + k + ' (modo=' + c.n.C[0] + ' ini=' + c.n.C[1] + ' paro=' + c.n.C[2] + ' st=' + c.v.stp + ' F=' + c.n.M[1] + '): ' + d.slice(0, 4).join('; ')); }
    }
    for (k = 0; k < N; k++) {
        var c = casoPid(fPar);
        // (1) igual que PID.c v18 con seta = 1 y bomba en marcha
        var oN = pid(fN, c.n);
        if (c.soloOk) {          // el nodo viejo no conoce 'ok': aqui solo se exige la reaccion del nuevo
            d = [];
            if (oN.u !== -0.5 || oN.So[1] !== 0 || oN.E[9] !== 1) d.push('ok = 0 sin reaccion: u=' + oN.u + ' So[1]=' + oN.So[1] + ' E[9]=' + oN.E[9]);
        } else d = difs(esperadoDeViejo(viejo(fV, c.v), c), oN);
        if (d.length) anota('igual', k, d, c);
        if (c.n.C.length < 20) continue;
        // (2) seta pulsada = PARO del panel
        var oParo = pid(fN, con(c.n, { paro: 1 }));
        var e = copia(oParo); e.E[15] = 0;
        d = difs(e, pid(fN, con(c.n, { paro: 0, seta: 0 })));
        if (d.length) anota('seta', k, d, c);
        // (3) bomba detenida: como el PARO en lo continuo; en lo discreto, FALLA 6 si habia ensayo y aviso 6 si no
        var oB = pid(fN, con(c.n, { paro: 0, uph: 0 }));
        e = copia(oParo); e.E[16] = 0;
        if (!c.malo) {
            var oNorm = pid(fN, con(c.n, { paro: 0 }));
            var stn = oNorm.So[12], st = (stn >= 1 && stn <= 4) ? 5 : stn;
            var ca = (stn >= 1 && stn <= 4) ? 6 : oNorm.So[11];
            e.So[12] = st; e.So[11] = ca; e.E[1] = st; e.E[9] = (st == 5) ? 1 : 0; e.E[10] = (st != 5) ? 6 : ca;
            e.E[22] = 0; e.E[23] = 0;
            if (stn >= 1 && stn <= 4) r.falla6++; else if (st != 5) r.aviso6++;
            d = difs(e, oB);
            if (!(oB.u === -0.5)) d.push('u con la bomba detenida: ' + oB.u);
        } else {
            d = [];
            if (!(oB.u === -0.5) || oB.So[1] !== 0) d.push('dato invalido con bomba detenida: u=' + oB.u + ' So[1]=' + oB.So[1]);
        }
        if (d.length) anota('bomba', k, d, c);
        // paro y bomba detenida a la vez = PARO
        e = copia(oParo); e.E[16] = 0;
        d = difs(e, pid(fN, con(c.n, { paro: 1, uph: 0 })));
        if (d.length) anota('bomba', k, d, c);
        // integrador congelado en paro y con la bomba detenida (los limites solo lo recortan hacia 0)
        var Sval = c.n.S.length >= 17 && c.n.S[1] > 0;
        if (Sval && !c.malo) {
            var lim = (c.n.M[1] >= 160) || (presOn && (c.n.M[2] >= 95 || 2.0106 * c.n.M[2] - 1.5080 * c.n.M[3] >= 160));
            var i0 = c.n.S[3], iesp = i0;
            if (c.n.M[1] <= -160) iesp = Math.max(iesp, 0);
            if (lim) iesp = Math.min(iesp, 0);
            // la proteccion de fuerza fuera de ensayo (F > F_lib >= 0.2 kN) tambien puede recortarlo a <= 0
            var rec = c.n.M[1] > 0.2 ? Math.min(iesp, 0) : iesp;
            d = [];
            if (oParo.So[3] !== iesp && oParo.So[3] !== rec) d.push('integ en PARO: ' + i0 + ' -> ' + oParo.So[3]);
            if (oB.So[3] !== iesp && oB.So[3] !== rec) d.push('integ con bomba detenida: ' + i0 + ' -> ' + oB.So[3]);
            if (d.length) anota('integ', k, d, c);
            // primer paso de un ensayo sin paro ni limites: el comando sale del integrador, no de 0 V
            if (c.n.C[1] > 0.5 && c.n.S[15] < 0.5 && c.n.C[2] < 0.5 && !lim && Math.abs(c.n.M[1]) < 160) {
                var cod = c.n.C[16] == 2026;
                var Kx = cod ? Math.max(1, Math.min(100, c.n.C[17])) : 30, Ti = cod ? Math.max(0.1, Math.min(60, c.n.C[18])) : 1.5;
                var ui = Math.max(-10, Math.min(10, Kx * i0 / Ti)), up = c.n.S[9], dtp = c.n.M[6];
                if (dtp <= 0 || dtp > 1) dtp = 0.02;
                var uesp = Math.max(up - 40 * dtp, Math.min(up + 40 * dtp, ui));
                r.inicios++;
                if (!igual(uesp, oN.u)) anota('integ', k, ['u al iniciar: esperado ' + uesp + ', obtenido ' + oN.u], c);
            }
        }
    }
    return r;
}

// =====================================================================================
// UPH
// =====================================================================================
// Logica cableada en el lazo digital de la v16 (leida del diagrama el 2026-11-12).
function uphV16(seta, paro, enc, apa, salir, q) {
    var ok = (seta > 0.5) && !(salir > 0.5);
    var R = !ok || apa > 0.5 || paro > 0.5;
    var E = enc > 0.5;
    var Q = (E != R) ? E : (q > 0.5);
    return { bomba: Q ? 1 : 0, do2: ok ? 0 : 1 };
}
function pruebaUph(tUph, verboso) {
    var f = compila(tUph, ['D', 'C', 'Gp'], ['O', 'G'], 0);
    var r = { combos: 0, fallos: 0, cambian: 0, cambianMal: 0 }, b, i;
    function falla(m) { r.fallos++; if (verboso && r.fallos <= 6) WScript.Echo('    FALLO UPH: ' + m); }
    for (b = 0; b < 1024; b++) {
        var seta = b & 1, paro = (b >> 1) & 1, enc = (b >> 2) & 1, apa = (b >> 3) & 1, salir = (b >> 4) & 1, q = (b >> 5) & 1;
        var nivel = (b >> 6) & 1, filtro = (b >> 7) & 1, guarda = (b >> 8) & 1, marcha = (b >> 9) & 1;
        var D = [seta, nivel, filtro, 0, 0, guarda, 0, marcha], C = ceros(21); C[2] = paro; C[3] = enc; C[4] = apa; C[5] = salir;
        var o = f(D, C, [1, 0, q, 0, 0, 0, 0, 0]), v = uphV16(seta, paro, enc, apa, salir, q);
        r.combos++;
        var esp = [seta, marcha, o.G[2], nivel, filtro, guarda, salir, (o.G[2] && !marcha) ? 1 : 0];
        for (i = 0; i < 8; i++) if (o.G[i] !== esp[i]) falla('G[' + i + '] con b=' + b);
        for (i = 0; i < 8; i++) if (o.O[i] !== (i == 0 ? o.G[2] : (i == 2 ? v.do2 : (i == 5 ? 1 : 0)))) falla('O[' + i + '] con b=' + b);
        var apaga = !seta || paro || apa || salir;
        if (o.G[2] !== v.bomba) { r.cambian++; if (!(enc && apaga && q)) { r.cambianMal++; falla('bomba distinta de la v16 fuera del caso previsto, b=' + b); } }
        if (apaga && o.G[2] !== 0) falla('el apagado no manda, b=' + b);
        if (!apaga && enc && o.G[2] !== 1) falla('Encender no arranca, b=' + b);
        if (!apaga && !enc && o.G[2] !== q) falla('no conserva la orden, b=' + b);
    }
    // entradas incompletas: bomba apagada y seta como pulsada
    var o1 = f([], ceros(21), [1, 1, 1, 1, 1, 0, 0, 0]), o2 = f([1, 1, 1, 0, 0, 0, 0, 1], [], [1, 1, 1, 1, 1, 0, 0, 0]), o3 = f([1, 1, 1, 0, 0, 0, 0, 1], (function () { var c = ceros(21); c[3] = 1; return c; })(), []);
    if (o1.G[2] !== 0 || o1.G[0] !== 0 || o1.O[2] !== 1 || o1.O[5] !== 1) falla('sin DI debe apagar y dar seta = 0');
    if (o2.G[2] !== 0) falla('sin comandos debe apagar');
    if (o3.G[2] !== 1) falla('primera iteracion con Encender debe arrancar');
    // bomba que no confirma: secuencias de 400 pasos (8 s) con Encender en el paso 10
    function secuencia(marchaDe) {
        var Gp = [], k, hist = [];
        for (k = 0; k < 400; k++) { var C = ceros(21); C[3] = (k == 10) ? 1 : 0; var o = f([1, 1, 1, 0, 0, 0, 0, marchaDe(k)], C, Gp); Gp = o.G; hist.push(o.G[2]); }
        return hist;
    }
    var h1 = secuencia(function (k) { return 0; });                                            // nunca confirma
    if (!(h1[9] == 0 && h1[10] == 1 && h1[109] == 1 && h1[110] == 0 && h1[399] == 0)) falla('sin confirmacion debe retirar la orden a los 2 s: ' + h1[108] + h1[109] + h1[110] + h1[111]);
    var h2 = secuencia(function (k) { return k >= 20 ? 1 : 0; });                              // confirma a los 0.2 s
    if (!(h2[10] == 1 && h2[399] == 1)) falla('con confirmacion debe mantener la orden');
    var h3 = secuencia(function (k) { return (k >= 20 && k < 200) ? 1 : 0; });                 // la marcha se pierde en el paso 200
    if (!(h3[199] == 1 && h3[299] == 1 && h3[300] == 0 && h3[399] == 0)) falla('si la marcha se pierde debe retirar la orden 2 s despues: ' + h3[299] + h3[300] + h3[301]);
    var h4 = secuencia(function (k) { return (k >= 20 && (k < 200 || k >= 250)) ? 1 : 0; });   // corte de 1 s de la confirmacion
    if (!(h4[399] == 1)) falla('un corte de 1 s de la confirmacion no debe retirar la orden');
    return r;
}

// =====================================================================================
// ENTRADAS
// =====================================================================================
function pruebaEntradas(tEnt, N, verboso) {
    var f = compila(tEnt, ['V'], ['M'], 0), r = { casos: 0, fallos: 0 }, k, i, c;
    function falla(m) { r.fallos++; if (verboso && r.fallos <= 6) WScript.Echo('    FALLO ENTRADAS: ' + m); }
    for (k = 0; k < N; k++) {
        var n = elige([1, 7, 50, 400]), V = [[], [], [], []], s = [0, 0, 0, 0];
        var base = [U(0, 10), U(-0.05, 10), U(1.9, 10), U(1.9, 10)], tipo = rnd();
        if (tipo < 0.05) base[0] = elige([-1, 10.8]); else if (tipo < 0.10) base[1] = elige([-0.9, 10.9]);
        else if (tipo < 0.15) base[2] = U(0, 1.4); else if (tipo < 0.20) base[3] = elige([0.2, 10.7]);
        for (c = 0; c < 4; c++) for (i = 0; i < n; i++) { V[c][i] = base[c] + U(-0.02, 0.02); s[c] += V[c][i]; }
        var nan = -1; if (tipo > 0.97) { nan = Math.floor(rnd() * 4); V[nan][Math.floor(rnd() * n)] = NaN; s[nan] = NaN; }
        var m = [s[0] / n, s[1] / n, s[2] / n, s[3] / n], M = f(V).M;
        var esp = [15 * m[0], 20 * m[1], (m[2] - 1.9826) * 12.5, (m[3] - 1.9682) * 50];
        r.casos++;
        for (c = 0; c < 4; c++) if (!igual(esp[c], M[c])) falla('M[' + c + '] = ' + M[c] + ', esperado ' + esp[c]);
        var ok = (m[0] === m[0] && m[1] === m[1] && m[0] >= -0.5 && m[0] <= 10.5 && m[1] >= -0.5 && m[1] <= 10.5) ? 1 : 0;
        var av = ((m[2] !== m[2] || m[2] < 1.5 || m[2] > 10.5) ? 1 : 0) + ((m[3] !== m[3] || m[3] < 1.5 || m[3] > 10.5) ? 2 : 0);
        if (M[4] !== ok) falla('ok = ' + M[4] + ', esperado ' + ok + ' (V0=' + m[0] + ' V1=' + m[1] + ')');
        if (M[5] !== av) falla('aviso = ' + M[5] + ', esperado ' + av);
        if (!igual(M[6], n / 200000)) falla('dt = ' + M[6]);
    }
    // el caso real: 4000 muestras -> 20 ms exactos
    var V4 = [[], [], [], []]; for (c = 0; c < 4; c++) for (i = 0; i < 4000; i++) V4[c][i] = 4;
    if (f(V4).M[6] !== 0.02) falla('4000 muestras no dan 0.02 s');
    // sin muestras o con menos de 4 canales: no valido
    if (f([[], [], [], []]).M[4] !== 0) falla('sin muestras debe dar ok = 0');
    if (f([[1, 1], [1, 1], [3, 3]]).M[4] !== 0) falla('con 3 canales debe dar ok = 0');
    if (f([]).M[4] !== 0) falla('sin canales debe dar ok = 0');
    return r;
}

// =====================================================================================
// TRAYECTOS: cadena completa (ENTRADAS -> UPH -> PID) frente a la v16 (lazo digital a 500 ms + PID.c v18)
// =====================================================================================
// ley comando-velocidad medida (dos rectas); se empalman donde se cruzan (0.379 V) para que la planta sea
// continua: con el salto en u = 0, un redondeo de 1e-15 en la medida cambiaba la velocidad de la planta
function vley(u) { return u >= 0.37941 ? 0.4459 * u + 0.1139 : 0.3779 * u + 0.1397; }
function nuevaPlanta(x0) { return { x: x0, p: 0, marcha: 0, uap: -0.5, kc: 14, xc: 60 }; }
function fuerza(pl) { return pl.kc * Math.max(0, pl.x - pl.xc); }
// p = presion disponible (0..1): sube en ~2 s con la bomba en marcha y cae en ~60 s al pararla (acumulador)
function avanza(pl, u, bomba, Ts) {
    var v = vley(pl.uap) * pl.p, F = fuerza(pl);
    if (v > 0) v = v * Math.max(0, 1 - F / 200);
    pl.x = Math.min(150, Math.max(0, pl.x + v * Ts));
    pl.p += (pl.marcha ? (1 - pl.p) / 2 : -pl.p / 60) * Ts;
    pl.marcha = bomba; pl.uap = u;
}
function trayecto(esc, f, nuevo) {
    var Ts = 0.02, pl = nuevaPlanta(esc.x0), nT = Math.round(esc.dur / Ts), k, i;
    var reg = { t: [], x: [], F: [], u: [], st: [], causa: [], falla: [], bomba: [], v: [] };
    var S = [], Gp = [], est = { stp: 0, f0p: 0, tsp: 0, inip: 0, S: ceros(12) }, q = 0, bomba = 0, xant = esc.x0;
    if (esc.p0) { pl.p = 1; pl.marcha = 1; q = 1; bomba = 1; Gp = [1, 1, 1, 1, 1, 0, 0, 0]; pl.uap = -0.3697; }
    for (k = 0; k < nT; k++) {
        var t = k * Ts, F = fuerza(pl), c = esc.fn(t), u, st, causa, falla;
        var seta = c.seta, guarda = c.guarda ? 1 : 0, marcha = (pl.marcha && !guarda) ? 1 : 0;
        if (guarda) pl.marcha = 0;                                 // el guardamotor corta el motor aunque siga la orden
        if (nuevo) {
            var V = [[], [], [], []], vx = c.nan ? NaN : pl.x / 15;
            for (i = 0; i < 8; i++) { V[0][i] = vx; V[1][i] = F / 20; V[2][i] = 1.9826 + 35 / 12.5; V[3][i] = 1.9682 + 47 / 50; }
            var M = f.ent(V).M; M[6] = Ts;                         // 8 muestras para ir rapido; el periodo real son 20 ms
            var C = [c.modo, c.ini, c.paro, c.enc, c.apa, 0, c.sinprot, c.pos, c.Fd, c.limx, c.limF, c.rx, c.rF, c.tc, 50, c.Flib, 0, 0, 0, 0, k];
            var oU = f.uph([seta, 1, 1, 0, 0, guarda, 0, marcha], C, Gp); Gp = oU.G;
            var o = f.pid(M, oU.G, C, S, 1000 + t); S = o.So;
            u = o.u; st = o.E[1]; causa = o.E[10]; falla = o.E[9]; bomba = oU.O[0];
        } else {
            if (k % 25 == 0) q = uphV16(seta, c.paro, c.enc || c.encLargo, c.apa, 0, q).bomba;   // lazo digital cada 500 ms
            bomba = q;
            var e = { x: c.nan ? NaN : pl.x, F: F, modo: c.modo, t: t, tr: 1000 + t, pa: 35, pb: 47, vjog: 50, Flib: c.Flib, sinprot: c.sinprot,
                      ini: 10 * c.ini, inip: est.inip, spm: c.modo ? c.Fd : c.pos, lim: c.modo ? c.limF : c.limx, rate: c.modo ? c.rF : c.rx,
                      tc: c.tc, xlim: c.limx, paro: c.paro, stp: est.stp, f0p: est.f0p, tsp: est.tsp, P: [30, 1.5, 0.5], S: est.S };
            var ov = viejo(f.viejo, e);
            est = { stp: ov.st, f0p: ov.f0, tsp: ov.ts, inip: ov.inio, S: ov.So };
            u = ov.u; st = ov.st; causa = ov.causa; falla = ov.falla;
        }
        reg.t.push(t); reg.x.push(pl.x); reg.F.push(F); reg.u.push(u); reg.st.push(st); reg.causa.push(causa); reg.falla.push(falla); reg.bomba.push(bomba);
        reg.v.push((pl.x - xant) / Ts); xant = pl.x;
        avanza(pl, u, bomba, Ts);
    }
    return reg;
}
function base(o) { var b = { modo: 0, ini: 0, paro: 0, enc: 0, encLargo: 0, apa: 0, sinprot: 0, pos: 60, Fd: 1, limx: 145, limF: 20, rx: 30, rF: 60, tc: 5.011, Flib: 4, seta: 1, guarda: 0, nan: 0 }; for (var k in o) b[k] = o[k]; return b; }
var ESC = [
    { nombre: 'ensayo de fuerza a 40 kN (bomba ya en marcha): debe ser igual', x0: 59.8, dur: 110, p0: 1, igual: 1,
      fn: function (t) { return base({ modo: 1, Fd: 1, ini: t > 15 ? 1 : 0, limF: 40, rF: 120 }); } },
    { nombre: 'ensayo de posicion 55 -> 61.53 mm a 31 mm/min (bomba ya en marcha): debe ser igual', x0: 55, dur: 60, p0: 1, igual: 1,
      fn: function (t) { return base({ pos: 55, ini: t > 2 ? 1 : 0, limx: 61.53, rx: 31 }); } },   // duraciones que no son multiplo de 20 ms
    { nombre: 'ENCENDER con la posicion deseada a 7 mm de la real (sin contacto)', x0: 40, dur: 40, ev: [10, 14],
      fn: function (t) { return base({ pos: 47, enc: (t >= 10 && t < 10.1) ? 1 : 0, encLargo: (t >= 10 && t < 10.6) ? 1 : 0 }); } },
    { nombre: 'SETA pulsada a media rampa de un ensayo de fuerza', x0: 59.8, dur: 60, p0: 1, ev: [30, 40],
      fn: function (t) { return base({ modo: 1, Fd: 1, ini: t > 15 ? 1 : 0, limF: 40, rF: 60, seta: (t >= 30 && t < 40) ? 0 : 1 }); } },
    { nombre: 'GUARDAMOTOR: la bomba se detiene manteniendo 20 kN', x0: 59.8, dur: 90, p0: 1, ev: [40, 70],
      fn: function (t) { return base({ modo: 1, Fd: 1, ini: t > 15 ? 1 : 0, limF: 20, rF: 120, tc: 60, guarda: t >= 40 ? 1 : 0 }); } }
];
function maxabs(a, b) { var m = 0, i; for (i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d > m || d !== d) m = d; } return m; }
function fmt(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toString(); }
function pruebaTrayectos(T, verboso) {
    var f = { viejo: compila(T.viejo, ENT_V, SAL_V, 0), viejoSin: compila(sinReinicioDelIntegrador(T.viejo), ENT_V, SAL_V, 0), ent: compila(T.ent, ['V'], ['M'], 0), uph: compila(T.uph, ['D', 'C', 'Gp'], ['O', 'G'], 0), pid: compila(T.pid, ['M', 'G', 'C', 'S', 'tr'], ['u', 'So', 'E'], 0) };
    var fallos = 0, i;
    for (i = 0; i < ESC.length; i++) {
        var a = trayecto(ESC[i], f, false), b = trayecto(ESC[i], f, true), n = a.t.length - 1, s = '  ' + ESC[i].nombre;
        if (ESC[i].igual) {      // la v17 debe coincidir con la v18 sin el reinicio del integrador; frente a la v18 tal cual cambia el arranque
            var f2 = { viejo: f.viejoSin, ent: f.ent, uph: f.uph, pid: f.pid }, a2 = trayecto(ESC[i], f2, false), ki = 0, k2;
            for (k2 = 1; k2 < a.st.length; k2++) if (a.st[k2] == 1 && a.st[k2 - 1] == 0) { ki = k2; break; }
            s += '\n      comando en el primer paso del ensayo: v16 ' + fmt(a.u[ki - 1], 3) + ' -> ' + fmt(a.u[ki], 3) + ' V;  v17 ' + fmt(b.u[ki - 1], 3) + ' -> ' + fmt(b.u[ki], 3) + ' V';
            a = a2;
        }
        if (ESC[i].igual) {
            var du = maxabs(a.u, b.u), dx = maxabs(a.x, b.x);
            if (!(du < 1e-6 && dx < 1e-6)) fallos++;
            s += '\n      max|dif| (v18 sin reinicio del integrador) / v17: u ' + du.toExponential(1) + ' V, x ' + dx.toExponential(1) + ' mm; Fmax ' + fmt(Math.max.apply(null, a.F), 2) + ' / ' + fmt(Math.max.apply(null, b.F), 2) + ' kN; estado final ' + a.st[n] + ' / ' + b.st[n];
        } else {
            var i0 = Math.round(ESC[i].ev[0] / 0.02), i1 = Math.round(ESC[i].ev[1] / 0.02), R = [a, b], nom = ['v16', 'v17'], j;
            for (j = 0; j < 2; j++) {
                var r = R[j], vmax = 0, k, um = 0;
                for (k = i0; k < i1; k++) { if (Math.abs(r.v[k]) > Math.abs(vmax)) vmax = r.v[k]; }
                s += '\n      ' + nom[j] + ': u justo antes ' + fmt(r.u[i0 - 1], 2) + ' V; durante el evento u ' + fmt(r.u[i0 + 5], 2) + ' -> ' + fmt(r.u[i1 - 1], 2) + ' V, velocidad max ' + fmt(vmax, 2) + ' mm/s, F ' + fmt(r.F[i0], 1) + ' -> ' + fmt(r.F[i1 - 1], 1) + ' kN, x ' + fmt(r.x[i0], 2) + ' -> ' + fmt(r.x[i1 - 1], 2) + ' mm; estado ' + r.st[i1 - 1] + ', causa ' + r.causa[i1 - 1] + ', bomba ' + r.bomba[i1 - 1];
            }
        }
        if (verboso) WScript.Echo(s);
    }
    return fallos;
}

// =====================================================================================
// principal
// =====================================================================================
function textos() {
    return { pid: lee(DIR + '\\v17\\Pid.c'), uph: lee(DIR + '\\v17\\Uph.c'), ent: lee(DIR + '\\v17\\Entradas.c'),
             viejo: lee(DIR + '\\PID.c'), par: lee(DIR + '\\ParamPID.c') };
}
function todo(T, N, verboso) {
    var total = 0, pres, r;
    for (pres = 0; pres < 2; pres++) {
        semilla = 12345 + pres;
        r = pruebaPid(T.pid, T.viejo, T.par, N, pres, verboso);
        total += r.igual + r.seta + r.bomba + r.integ;
        if (verboso) WScript.Echo('PID, corte por presiones ' + (pres ? 'ACTIVO' : 'desactivado') + ': ' + N + ' pasos -> distintos de PID.c v18: ' + r.igual + '; seta distinta de PARO: ' + r.seta + '; bomba detenida fuera de lo esperado: ' + r.bomba + '; integrador o arranque fuera de lo esperado: ' + r.integ + '   [' + r.inicios + ' inicios de ensayo, FALLA 6 en ' + r.falla6 + ' pasos, aviso 6 en ' + r.aviso6 + ']');
    }
    r = pruebaUph(T.uph, verboso); total += r.fallos;
    if (verboso) WScript.Echo('UPH: ' + r.combos + ' combinaciones -> ' + r.fallos + ' fallos; la orden de bomba difiere de la v16 en ' + r.cambian + ' (todas con Encender y apagado a la vez: ' + (r.cambianMal == 0 ? 'si' : 'NO') + ')');
    semilla = 99; r = pruebaEntradas(T.ent, Math.min(N, 20000), verboso); total += r.fallos;
    if (verboso) WScript.Echo('ENTRADAS: ' + r.casos + ' casos -> ' + r.fallos + ' fallos');
    return total;
}
var A = WScript.Arguments, modo = A.length ? A(0) : 'todo', N = A.length > 1 ? parseInt(A(1), 10) : 100000, T = textos();
if (modo == 'todo') {
    var tot = todo(T, N, true);
    WScript.Echo('TRAYECTOS'); tot += pruebaTrayectos(T, true);
    WScript.Echo(tot ? ('HAY ' + tot + ' FALLOS') : 'TODO CORRECTO');
    WScript.Quit(tot ? 1 : 0);
} else if (modo == 'trayecto') {
    pruebaTrayectos(T, true);
} else if (modo == 'mutantes') {
    var MUT = [
        ['pid', 'if (paro>0.5 || seta<0.5) en_paro = 1;', 'if (paro>0.5) en_paro = 1;'],
        ['pid', 'if (en_paro>0.5 || uph<0.5) { u=u_seguro;', 'if (en_paro>0.5) { u=u_seguro;'],
        ['pid', 'if (st>=ST_CARGA && st<=ST_RETORNO && uph<0.5)         { st=ST_FALLA; causa_act=CAU_BOMBA;', 'if (st>=ST_CARGA && st<=ST_DESCARGA && uph<0.5)         { st=ST_FALLA; causa_act=CAU_BOMBA;'],
        ['pid', 'if (uph<0.5 && st!=ST_FALLA) causa = CAU_BOMBA;', ''],
        ['pid', '    if (modo>0.5) { spm=C[8]; lim=C[10]; rate=C[12]; }', '    if (modo>0.5) { spm=C[8]; lim=C[10]; rate=C[11]; }'],
        ['pid', '    xlim=C[9]; tc=C[13]; vjog=C[14]; Flib=C[15];', '    xlim=C[10]; tc=C[13]; vjog=C[14]; Flib=C[15];'],
        ['pid', '        Tix = max(0.1,min(60,C[18]));', '        Tix = max(0.1,min(60,C[17]));'],
        ['pid', 'if (ini>0.5 && inip<0.5) t = dt;', ''],
        ['pid', 'So[12]=st;    So[13]=f0;       So[14]=ts;      So[15]=ini;      So[16]=t;', 'So[12]=st;    So[13]=f0;       So[14]=t;      So[15]=ini;      So[16]=t;'],
        ['pid', 'if (!(x==x) || !(F==F) || ok<0.5 || par_ok<0.5) {', 'if (!(x==x) || !(F==F) || par_ok<0.5) {'],
        ['pid', 'if (sizeOfDim(S,0)>=17) { stp=S[12]; f0p=S[13]; tsp=S[14]; inip=S[15]; t=S[16]; }', 'if (sizeOfDim(S,0)>=17 && S[1]>0) { stp=S[12]; f0p=S[13]; tsp=S[14]; inip=S[15]; t=S[16]; }'],
        ['pid', 'E[21]=F_pico; E[22]=prog;   E[23]=trest;', 'E[21]=F_pico; E[22]=trest;   E[23]=prog;'],
        ['pid', 'if (abs(u)<u_max && en_paro<0.5 && uph>0.5) integ = integ + err*dt;', 'if (abs(u)<u_max) integ = integ + err*dt;'],
        ['pid', 'if (en_paro>0.5 || uph<0.5) { u=u_seguro; x_ref=x; sp=med; }', 'if (en_paro>0.5 || uph<0.5) { u=u_seguro; integ=0; x_ref=x; sp=med; }'],
        ['pid', '    x_ref = x;\n    sp_prev = med;', '    x_ref = x;\n    integ = 0;\n    sp_prev = med;'],
        ['uph', 'if (sin_marcha>pasos_conf) { bomba = 0; sin_marcha = 0; }', ''],
        ['uph', 'else sin_marcha = 0;', ''],
        ['uph', 'if (bomba>0.5 && marcha<0.5) sin_marcha = sin_marcha + 1;', 'if (bomba>0.5) sin_marcha = sin_marcha + 1;'],
        ['uph', 'if (seta<0.5 || paro>0.5 || apagar>0.5 || salir>0.5) bomba = 0;', 'if (seta<0.5 || apagar>0.5 || salir>0.5) bomba = 0;'],
        ['uph', 'if (encender>0.5) bomba = 1;\nif (seta<0.5 || paro>0.5 || apagar>0.5 || salir>0.5) bomba = 0;', 'if (seta<0.5 || paro>0.5 || apagar>0.5 || salir>0.5) bomba = 0;\nif (encender>0.5) bomba = 1;'],
        ['uph', 'if (seta<0.5 || salir>0.5) O[2] = 1;', 'if (seta<0.5) O[2] = 1;'],
        ['uph', 'seta=D[0]; nivel=D[1]; filtro=D[2]; guarda=D[5]; marcha=D[7];', 'seta=D[0]; nivel=D[1]; filtro=D[2]; guarda=D[5]; marcha=D[6];'],
        ['ent', 'M[2] = (v2-1.9826)*12.5;', 'M[2] = (v2-1.9682)*12.5;'],
        ['ent', '    v1 = v1 + V[1][i];', '    v1 = v1 + V[0][i];'],
        ['ent', 'if (v0<v_min || v0>v_max || v1<v_min || v1>v_max) M[4] = 0;', 'if (v0<v_min || v0>v_max || v1>v_max) M[4] = 0;'],
        ['ent', 'if (!(v3==v3) || v3<v_lazo || v3>v_max) M[5] = M[5] + 2;', 'if (!(v3==v3) || v3<v_lazo || v3>v_max) M[5] = M[5] + 1;']
    ];
    var detect = 0, m;
    N = A.length > 1 ? N : 20000;
    for (m = 0; m < MUT.length; m++) {
        var T2 = textos(), k2 = MUT[m][0], limpio = T2[k2].replace(/\r/g, '');
        if (limpio.indexOf(MUT[m][1]) < 0) { WScript.Echo('  mutante ' + m + ': NO ENCUENTRO el texto original'); continue; }
        T2[k2] = limpio.replace(MUT[m][1], MUT[m][2]);
        var f = todo(T2, N, false);
        if (f > 0) detect++;
        WScript.Echo('  mutante ' + m + ' (' + k2 + ') [' + (MUT[m][2].replace(/\n/g, ' / ').substr(0, 70) || 'linea quitada') + ']: ' + (f > 0 ? 'detectado (' + f + ')' : 'NO DETECTADO'));
    }
    WScript.Echo(detect + ' de ' + MUT.length + ' mutantes detectados');
    WScript.Quit(detect == MUT.length ? 0 : 1);
} else { WScript.Echo('uso: cscript //nologo pruebas\\arnes_v17.js todo|mutantes|trayecto [N]'); WScript.Quit(2); }
