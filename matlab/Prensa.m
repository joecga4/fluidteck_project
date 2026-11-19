classdef Prensa < handle
%PRENSA  Prensa UPH 50 en LAZO ABIERTO desde MATLAB (cDAQ-9184): encender la UPH,
%   enviar un comando a la servovalvula y registrar los cuatro sensores.
%
%   Version minima (2026-11-12). La version completa (jog, caracteriza, satura,
%   escalonesFuerza, calibraPresion, latencia, simula, excitacion...) esta en git:
%       git show 255b728:matlab/Prensa.m
%
%   SEGURIDAD (CLAUDE.md §6)
%     * Mueve un cilindro de 200 kN. Alguien junto a la seta; sin probeta.
%     * Nada escribe en el AO ni en el DO sin 'Armar',true: sin eso, ensayo en seco.
%     * escribe() NO vigila nada. lazoAbierto() vigila posicion, fuerza y presiones
%       y aborta a 0 V. Ninguno sustituye a la seta ni a la limitadora.
%     * Velocidad nula en U_NULL (-0.37 V), NO en 0 V: a 0 V el vastago se extiende
%       ~8 mm/min. El null deriva con la temperatura del aceite.
%     * Antes de parar la UPH, separar el vastago >= 15 mm de cualquier tope.
%     * LabVIEW y NI MAX CERRADOS (reservan los modulos).
%
%   SESION TIPICA
%       p = Prensa();                          % localiza los modulos (solo lectura)
%       p.lee();                               % estado de los 4 sensores
%       p.hpu(true, 'Armar', true);            % AO a 0 V y arranca la UPH
%       pause(Prensa.CALENTAMIENTO);           % 3 min: transitorio de presion
%       p.escribe(Prensa.U_NULL, 'Armar', true);          % comando fijo, sin vigilancia
%       u = [zeros(2000,1); ones(3000,1); -ones(3000,1)] + Prensa.U_NULL;
%       r = p.lazoAbierto(u, 'Ts', 1e-3, 'Etiqueta', 'prueba', 'Armar', true);
%       plot(r.t, r.posicion)
%       p.hpu(false, 'Armar', true);           % para la UPH, AO a 0 V
%
%   Signo: u > 0 extiende el vastago (baja) y aumenta la posicion medida.

    properties (Constant)
        P = Prensa.cargaParams();             % simulink/params_prensa.m (escalas de sensor)

        % ai0..ai3 del NI 9222:  ingenieria = (V - V_CERO).*ESCALA
        NOMBRES = {'posicion', 'fuerza', 'presion_A', 'presion_B'};    % mm, kN, bar, bar
        V_CERO  = [0, 0, Prensa.P.pA_off, Prensa.P.pB_off];            % [V]
        ESCALA  = [Prensa.P.Kx_sens, Prensa.P.KF_sens, Prensa.P.pA_esc, Prensa.P.pB_esc];

        U_NULL = -0.1397/0.3779;              % [V] velocidad nula (ley medida 2026-08-13)
        CALENTAMIENTO = 180;                  % [s] espera tras arrancar la bomba

        % limites por software (los vigila lazoAbierto)
        X_MIN = 20;  X_MAX = 130;             % [mm]
        F_MAX = 50;                           % [kN]
        PA_MAX = 110;  PB_MAX = 130;          % [bar]
        U_MAX = 10;                           % [V]

        % puerto DO del NI 9472 (line0..7): line0 = bomba, line5 = alimentacion de
        % los transductores de presion, SIEMPRE alta (por eso se escribe el puerto entero)
        DO_PARADA = [0 0 0 0 0 1 0 0];
        DO_MARCHA = [1 0 0 0 0 1 0 0];
    end

    properties (SetAccess = private)
        Mods            % DeviceID de los modulos: ai, ao, di, do
    end

    properties (Access = private)
        AO              % sesion del AO a demanda
        DO              % sesion del puerto DO (tomada mientras la UPH esta en marcha)
        Cap             % estado de la captura en curso (callbacks)
    end

    methods
        function obj = Prensa()
        %PRENSA  Localiza los modulos por su nombre de NI MAX (PrensaLEDI_AI/AO/DI/DO).
            dl = daqlist("ni");
            obj.Mods = struct('ai', '', 'ao', '', 'di', '', 'do', '');
            for k = 1:height(dl)
                id = char(dl.DeviceID(k));
                for f = {'ai', 'ao', 'di', 'do'}
                    if contains(id, ['PrensaLEDI_' upper(f{1})]), obj.Mods.(f{1}) = id; end
                end
            end
            falta = fieldnames(obj.Mods);  falta = falta(structfun(@isempty, obj.Mods));
            if any(ismember(falta, {'ai', 'ao', 'do'}))
                error('Prensa:modulos', 'Faltan modulos: %s. Revisar NI MAX.', strjoin(falta, ', '));
            end
        end

        function delete(obj)
        %DELETE  Al destruir el objeto: AO a 0 V y UPH parada.
            obj.liberaAO();
            if ~isempty(obj.DO) && isvalid(obj.DO)
                try, write(obj.DO, Prensa.DO_PARADA); catch, end
            end
        end

        function e = lee(obj)
        %LEE  Estado actual (media de 20 ms a 1 kHz). SOLO LECTURA.
            d = obj.abreAI();  d.Rate = 1000;
            E = mean(Prensa.convierte(read(d, 20, "OutputFormat", "Matrix")), 1);
            e = cell2struct(num2cell(E(:)), Prensa.NOMBRES(:), 1);
            fprintf('  x = %.2f mm   F = %.2f kN   P_A = %.1f bar   P_B = %.1f bar\n', E);
        end

        function hpu(obj, encender, o)
        %HPU  Arranca (true) o para (false) la UPH. Pone antes el AO a 0 V: el NI 9263
        %   conserva la ultima tension. La UPH sigue en marcha mientras exista el
        %   objeto o hasta hpu(false).
            arguments, obj, encender (1,1) logical, o.Armar (1,1) logical = false, end
            if ~o.Armar
                fprintf('  [seco] AO a 0 V y bomba a %d. Anadir ''Armar'',true.\n', encender);  return
            end
            obj.escribe(0, 'Armar', true);
            if isempty(obj.DO) || ~isvalid(obj.DO)
                obj.DO = daq("ni");
                addoutput(obj.DO, obj.Mods.do, "port0/line0:7", "Digital");
            end
            if encender, write(obj.DO, Prensa.DO_MARCHA); else, write(obj.DO, Prensa.DO_PARADA); end
            pause(1);
            if ~isempty(obj.Mods.di)                 % DI7 = confirmacion de marcha (KM1)
                d = daq("ni");  addinput(d, obj.Mods.di, "port0/line0:7", "Digital");
                b = double(read(d, "OutputFormat", "Matrix"));
                fprintf('  DI7 (motor en marcha) = %d\n', b(8));
            end
            if encender
                fprintf('[ok] UPH EN MARCHA. Esperar %d s antes de medir.\n', Prensa.CALENTAMIENTO);
            else
                obj.DO = [];
                fprintf('[ok] UPH PARADA.\n');
            end
        end

        function escribe(obj, u, o)
        %ESCRIBE  Fija el comando de la servovalvula [V] y lo MANTIENE. Sin vigilancia.
            arguments, obj, u (1,1) double, o.Armar (1,1) logical = false, end
            if abs(u) > Prensa.U_MAX, error('Prensa:rango', '|u| = %.2f V supera %g V.', abs(u), Prensa.U_MAX); end
            if ~o.Armar
                fprintf('  [seco] escribiria %+.3f V en el AO. Anadir ''Armar'',true.\n', u);  return
            end
            if isempty(obj.AO) || ~isvalid(obj.AO)
                obj.AO = daq("ni");
                ch = addoutput(obj.AO, obj.Mods.ao, "ao0", "Voltage");  ch.Range = [-10 10];
            end
            write(obj.AO, u);
            fprintf('[ok] AO a %+.3f V\n', u);
        end

        function r = lazoAbierto(obj, u, o)
        %LAZOABIERTO  Emite la secuencia u [V] (una muestra por Ts) y registra los 4 AI.
        %
        %   r = p.lazoAbierto(u, 'Ts', 1e-3, 'Etiqueta', 'prueba', 'Armar', true)
        %
        %   AO y AI comparten el reloj del chasis: comando y medida quedan alineados y
        %   el Ts es exacto. Cada BufferS segundos se vigilan posicion, fuerza y
        %   presiones: si algo se sale, AO a 0 V y se guarda lo registrado. Ctrl-C
        %   tambien deja el AO a 0 V. Al terminar el AO queda a 0 V (no en U_NULL).
        %   Devuelve t, u, posicion [mm], fuerza [kN], presion_A/B [bar] y abortado
        %   ('' si completo). Guarda results/captura_<Etiqueta>.csv.
        %
        %   Despues corre el modelo Simulink con la MISMA secuencia, partiendo de la
        %   posicion y las presiones medidas al inicio, lo deja en r.modelo y dibuja
        %   las cuatro lecturas planta/modelo. 'Modelo',false lo omite. En seco (sin
        %   'Armar') dibuja solo el modelo.
            arguments, obj, u (:,1) double
                o.Ts (1,1) double = 1e-3, o.Etiqueta (1,1) string = "captura"
                o.BufferS (1,1) double = 0.3, o.Modelo (1,1) logical = true
                o.Armar (1,1) logical = false
            end
            fs = 1/o.Ts;  nTot = numel(u);  nBuf = max(1, round(o.BufferS*fs));
            if max(abs(u)) > Prensa.U_MAX
                error('Prensa:rango', 'La secuencia pide %.2f V (limite %g V).', max(abs(u)), Prensa.U_MAX);
            end
            fprintf('LAZO ABIERTO ''%s'': %d muestras (%.1f s a %.0f Hz), comando %+.3f .. %+.3f V\n', ...
                o.Etiqueta, nTot, nTot/fs, fs, min(u), max(u));
            e = obj.lee();
            fallo = Prensa.fueraDeLimites(cell2mat(struct2cell(e)).');
            if ~isempty(fallo), error('Prensa:aborta', 'Estado inicial fuera de limites: %s', fallo); end
            if ~o.Armar
                fprintf('  [seco] no se escribe nada. Anadir ''Armar'',true.\n');  r = [];
                if o.Modelo                  % solo el modelo, desde el estado leido
                    Prensa.grafica(Prensa.simula(u, o.Ts, e), [], o.Etiqueta + " (solo modelo)");
                end
                return
            end

            obj.liberaAO();             % el AO a demanda y el sincronizado no coexisten
            d = obj.abreAI();
            ch = addoutput(d, obj.Mods.ao, "ao0", "Voltage");  ch.Range = [-10 10];
            d.Rate = fs;
            d.ScansAvailableFcnCount = nBuf;
            d.ScansRequiredFcnCount = nBuf;
            obj.Cap = struct('u', u, 'nTot', nTot, 'nBuf', nBuf, 'iEsc', 0, 'nLeidas', 0, ...
                'reg', zeros(nTot, 4), 'abortado', '');
            d.ScansAvailableFcn = @(src, ~) obj.alLeer(src);
            d.ScansRequiredFcn  = @(src, ~) write(src, obj.siguienteTrozo(nBuf));
            d.ErrorOccurredFcn  = @(src, evt) obj.alError(src, evt);

            seguro = onCleanup(@() obj.cierraCaptura(d));
            preload(d, obj.siguienteTrozo(2*nBuf));
            start(d, "Continuous");
            while d.Running, pause(0.05); end
            if isempty(obj.Cap.abortado) && obj.Cap.nLeidas < nTot
                obj.Cap.abortado = 'la adquisicion se detuvo antes de tiempo';
            end
            clear seguro                 % stop + AO a 0 V
            fprintf('\n');

            C = obj.Cap;  n = C.nLeidas;  E = Prensa.convierte(C.reg(1:n, :));
            if ~isempty(C.abortado), fprintf('  !! ABORTADO: %s. AO a 0 V.\n', C.abortado); end
            r = struct('t', (0:n-1).'/fs, 'u', u(1:n), 'posicion', E(:,1), 'fuerza', E(:,2), ...
                'presion_A', E(:,3), 'presion_B', E(:,4), 'abortado', C.abortado);
            carpeta = fullfile(fileparts(fileparts(mfilename('fullpath'))), 'results');
            if ~isfolder(carpeta), mkdir(carpeta); end
            ruta = fullfile(carpeta, "captura_" + o.Etiqueta + ".csv");
            writetable(table(r.t, r.u, E(:,1), E(:,2), E(:,3), E(:,4), 'VariableNames', ...
                {'t_s', 'u_V', 'posicion_mm', 'fuerza_kN', 'presion_A_bar', 'presion_B_bar'}), ruta);
            fprintf('[ok] %s (%d muestras, %.1f s)\n', ruta, n, n/fs);

            % ---- el modelo con la MISMA senal y el mismo estado inicial ----
            r.modelo = [];
            if o.Modelo && n > 1
                try
                    k = 1:min(n, max(1, round(0.05*fs)));          % primeros 50 ms
                    e0 = cell2struct(num2cell(mean(E(k, :), 1).'), Prensa.NOMBRES(:), 1);
                    r.modelo = Prensa.simula(r.u, o.Ts, e0);
                    Prensa.grafica(r, r.modelo, o.Etiqueta);
                catch ME
                    fprintf('  !! el modelo no se pudo simular (los datos medidos ya estan guardados): %s\n', ME.message);
                end
            end
        end
    end

    methods (Static)
        function s = simula(u, Ts, e0)
        %SIMULA  Corre simulink/prensa_fluidtek.slx con la secuencia u [V] (ZOH cada Ts).
        %   e0: estado inicial (struct con posicion [mm] y presion_A/B [bar], como el
        %   que devuelve lee). Sin e0, los valores de params_prensa.
        %   Devuelve los mismos campos que lazoAbierto: t, u, posicion, fuerza,
        %   presion_A, presion_B.
            arguments, u (:,1) double, Ts (1,1) double, e0 = [], end
            carpeta = fullfile(fileparts(fileparts(mfilename('fullpath'))), 'simulink');
            n = numel(u);  t = (0:n-1).'*Ts;
            P = Prensa.cargaParams();
            if ~isempty(e0)
                P.x_ini  = e0.posicion*1e-3;
                P.PA_ini = max(e0.presion_A, 1)*1e5;
                P.PB_ini = max(e0.presion_B, 1)*1e5;
            end
            P.t_fin = n*Ts;
            fprintf('  simulando el modelo (%.1f s)...\n', n*Ts);
            in = Simulink.SimulationInput(fullfile(carpeta, 'prensa_fluidtek.slx'));
            in = in.setVariable('P', P);
            in = in.setVariable('cmd', [t u]);
            in = in.setModelParameter('StopTime', num2str(n*Ts, '%.10g'));
            out = sim(in);
            sal = out.yout.getElement(1);       % [x v PA PB Ps F F_hid xv]
            tt = sal.Values.Time;  y = squeeze(sal.Values.Data);
            if size(y, 1) ~= numel(tt), y = y.'; end
            y = interp1(tt, y, t, 'linear', 'extrap');      % el solver es de paso variable
            s = struct('t', t, 'u', u, 'posicion', y(:,1), 'fuerza', y(:,6), ...
                'presion_A', y(:,3), 'presion_B', y(:,4));
        end

        function f = grafica(r, s, titulo)
        %GRAFICA  Las cuatro lecturas: planta fisica (r) frente al modelo (s).
        %   Prensa.grafica(r, r.modelo)   o   Prensa.grafica(s) para un solo registro.
            if nargin < 2, s = []; end
            if nargin < 3, titulo = ""; end
            unidad = {'x [mm]', 'F [kN]', 'P_A [bar]', 'P_B [bar]'};
            f = figure('Name', 'Prensa: planta y modelo', 'Position', [100 80 900 780]);
            tl = tiledlayout(4, 1, 'TileSpacing', 'compact');  title(tl, titulo, 'Interpreter', 'none');
            ax = gobjects(4, 1);
            for k = 1:4
                c = Prensa.NOMBRES{k};
                ax(k) = nexttile;  plot(r.t, r.(c));  hold on;  grid on;  ylabel(unidad{k});
                if ~isempty(s)
                    plot(s.t, s.(c), '--');
                    m = min(numel(r.t), numel(s.t));
                    title(sprintf('%s: RMS planta - modelo = %.3g', strrep(c, '_', ' '), ...
                        sqrt(mean((r.(c)(1:m) - s.(c)(1:m)).^2))), 'FontWeight', 'normal');
                end
            end
            if ~isempty(s), legend(ax(1), 'planta', 'modelo', 'Location', 'northwest'); end
            xlabel(ax(4), 't [s]');  linkaxes(ax, 'x');
        end

        function P = cargaParams()
            if isempty(which('params_prensa'))
                addpath(fullfile(fileparts(fileparts(mfilename('fullpath'))), 'simulink'));
            end
            P = params_prensa();
        end

        function E = convierte(V)
        %CONVIERTE  Voltios [n x 4] -> mm, kN, bar, bar.
            E = (V - Prensa.V_CERO).*Prensa.ESCALA;
        end

        function fallo = fueraDeLimites(E)
        %FUERADELIMITES  '' si todas las filas de E estan dentro; si no, el motivo.
            fallo = '';
            if min(E(:,1)) < Prensa.X_MIN || max(E(:,1)) > Prensa.X_MAX
                fallo = sprintf('posicion %.1f..%.1f mm fuera de [%g, %g]', min(E(:,1)), max(E(:,1)), Prensa.X_MIN, Prensa.X_MAX);
            elseif max(E(:,2)) > Prensa.F_MAX
                fallo = sprintf('fuerza %.1f kN > %g', max(E(:,2)), Prensa.F_MAX);
            elseif max(E(:,3)) > Prensa.PA_MAX
                fallo = sprintf('presion A %.1f bar > %g', max(E(:,3)), Prensa.PA_MAX);
            elseif max(E(:,4)) > Prensa.PB_MAX
                fallo = sprintf('presion B %.1f bar > %g', max(E(:,4)), Prensa.PB_MAX);
            end
        end
    end

    methods (Access = private)
        function d = abreAI(obj)
            d = daq("ni");
            for k = 0:3
                ch = addinput(d, obj.Mods.ai, sprintf('ai%d', k), "Voltage");
                ch.TerminalConfig = "Differential";  ch.Range = [-10 10];
            end
        end

        function liberaAO(obj)
            if ~isempty(obj.AO) && isvalid(obj.AO)
                try, write(obj.AO, 0); catch, end
            end
            obj.AO = [];
        end

        % ---- callbacks de la captura ----
        function trozo = siguienteTrozo(obj, n)
            i = obj.Cap.iEsc;  j = min(i + n, obj.Cap.nTot);
            trozo = zeros(n, 1);                     % 0 V al acabarse la secuencia
            trozo(1:j-i) = obj.Cap.u(i+1:j);
            obj.Cap.iEsc = j;
        end

        function alLeer(obj, src)
            V = read(src, src.ScansAvailableFcnCount, "OutputFormat", "Matrix");
            n0 = obj.Cap.nLeidas;  m = min(size(V, 1), obj.Cap.nTot - n0);
            obj.Cap.reg(n0+1:n0+m, :) = V(1:m, :);
            obj.Cap.nLeidas = n0 + m;
            E = Prensa.convierte(V);
            fallo = Prensa.fueraDeLimites(E);
            if ~isempty(fallo), obj.Cap.abortado = fallo; end
            if ~isempty(obj.Cap.abortado) || obj.Cap.nLeidas >= obj.Cap.nTot
                stop(src);  return
            end
            fprintf('\r  %5.1f%%  x=%7.2f mm  F=%6.2f kN  P_A=%6.1f  P_B=%6.1f bar', ...
                obj.Cap.nLeidas/obj.Cap.nTot*100, mean(E, 1));
        end

        function alError(obj, src, evt)
            obj.Cap.abortado = ['error de adquisicion: ' evt.Error.message];
            try, stop(src); catch, end
        end

        function cierraCaptura(obj, d)
            try, stop(d); catch, end
            try, flush(d); catch, end
            delete(d);
            try, obj.escribe(0, 'Armar', true); catch, end      % estado seguro
        end
    end
end
