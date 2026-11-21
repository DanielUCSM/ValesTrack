'use strict';

const $ = selector => document.querySelector(selector);
const dialog = $('#editor');
const fields = $('#editor-fields');
const form = $('#edit-form');
const names = { VALE_SALIDA: 'Vales de salida', VALE_SALIDA_DETALLE: 'Detalle de vale' };
const primaryFields = [
    ['folio_n', 'Folio', 'text', 20, true], ['fecha_emision', 'Fecha de emisión', 'date', 0, true],
    ['fecha_entrega', 'Fecha de entrega', 'date', 0, false],
    ['tipo_salida', 'Tipo de salida', 'type', 50, true], ['motivo', 'Motivo', 'text', 250, true],
    ['id_area', 'Área', 'AREA', 0, true], ['id_proyecto', 'Proyecto', 'PROYECTO', 0, true],
    ['id_empleado_solicita', 'Solicitante', 'EMPLEADO', 0, true],
    ['id_empleado_autoriza', 'Responsable de autorización', 'EMPLEADO', 0, true],
    ['id_empleado_despacha', 'Responsable de despacho', 'EMPLEADO', 0, true],
];
const signatures = [
    ['firma_solicita', 'Firma del solicitante'],
    ['firma_autoriza', 'Firma de autorización'],
    ['firma_despacha', 'Firma de despacho'],
];
const examples = {
    folio_n: 'VS-0042',
    id_area: '101', id_proyecto: '201', id_empleado: '301',
    codigo_producto: 'MAT-PERF-01', descripcion_material: 'Perfil galvanizado de 3 m',
    cantidad_solicitada: '12', cantidad_autorizada: '10', cantidad_entregada: '8',
};
const searchExamples = {
    vales: 'Folio, área, proyecto o solicitante',
    EMPLEADO: 'ID, nombre o apellido',
    PRODUCTO: 'Código o descripción',
    AREA: 'ID o nombre del área',
    PROYECTO: 'ID o nombre del proyecto',
};
const selectionPrompts = {
    tipo_salida: 'Selecciona un tipo de salida',
    unidad: 'Selecciona una unidad',
    id_area: 'Selecciona un área',
    id_proyecto: 'Selecciona un proyecto',
    id_empleado_solicita: 'Selecciona al solicitante',
    id_empleado_autoriza: 'Selecciona a quien autoriza',
    id_empleado_despacha: 'Selecciona a quien despacha',
};
const guidance = {
    folio_n: 'Identificador único del vale.',
    fecha_emision: 'Elige la fecha de emisión, como máximo hoy.',
    fecha_entrega: 'Fecha de entrega real. Déjala en blanco si está pendiente.',
    tipo_salida: 'Indica el motivo operativo. El área indica quién solicita el material.',
    motivo: 'Describe el trabajo o destino.',
    id_area: 'Área que solicita el material.',
    id_proyecto: 'Obra o proyecto donde se usará el material.',
    id_empleado_solicita: 'Selecciona a la persona que pide los materiales.',
    id_empleado_autoriza: 'Selecciona a quien aprueba la salida.',
    id_empleado_despacha: 'Selecciona a quien entrega los materiales.',
    id_empleado: 'Número entero positivo y único.',
    segundo_nombre: 'Opcional.',
    codigo_producto: 'Código único, hasta 20 caracteres y sin barras.',
    descripcion_material: 'Identifica el material y su medida cuando corresponda.',
    unidad: 'Selecciona cómo se mide el material.',
    cantidad_solicitada: 'Cantidad pedida, mayor que cero.',
    cantidad_autorizada: 'Cantidad aprobada, de 0 hasta la solicitada.',
    cantidad_entregada: 'Cantidad despachada, de 0 hasta la autorizada.',
    observaciones: 'Opcional.',
};
const datePeru = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', dateStyle: 'short' });
const timePeru = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'medium' });
let modules;
let options;
let user;
let fieldId = 0;
let page;
let revision = 0;
let records = [];
let audit = [];
let auditBefore = null;
let auditTimer;
let editorState;
let busy = false;
let comboId = 0;

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function button(text, action, className) {
    const node = element('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
}

async function request(path, method = 'GET', data = {}) {
    const response = await fetch(path, method === 'GET' ? {} : {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const payload = await response.json();
    if (response.status === 401 && user && path !== '/api/login') {
        showSession(null);
        message($('#login-message'), 'Tu sesión terminó. Vuelve a iniciar sesión.', true);
    }
    if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
    return payload;
}

function message(node, text, error = false) {
    node.hidden = !text;
    node.textContent = text;
    node.classList.toggle('error', error);
}

function table(target, headers, rows, empty = 'No hay registros para mostrar.') {
    if (!rows.length) {
        target.replaceChildren(element('p', empty, 'meta'));
        target.removeAttribute('tabindex');
        return;
    }
    const node = element('table');
    const cards = target.dataset.mobileCards === 'true';
    if (cards) node.setAttribute('role', 'table');
    const head = node.createTHead().insertRow();
    if (cards) head.setAttribute('role', 'row');
    for (const name of headers) {
        const th = element('th', name);
        th.scope = 'col';
        if (cards) th.setAttribute('role', 'columnheader');
        head.append(th);
    }
    const body = node.createTBody();
    for (const values of rows) {
        const row = body.insertRow();
        if (cards) row.setAttribute('role', 'row');
        for (const [index, value] of values.entries()) {
            const cell = row.insertCell();
            if (cards) {
                cell.setAttribute('role', 'cell');
                cell.dataset.label = headers[index];
            }
            if (value instanceof Node) cell.append(value);
            else cell.textContent = value ?? '—';
        }
    }
    target.replaceChildren(node);
    target.tabIndex = 0;
}

function listOptions(select, entries, placeholder) {
    select.replaceChildren(new Option(placeholder, ''), ...entries.map(([key, name]) => new Option(name, key)));
}

function badge(text) {
    const node = element('span', text, 'badge');
    node.dataset.state = text;
    return node;
}

function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
}

function catalogUrl(key) { return '/api/catalogos/' + key; }
function valeUrl(folio) { return '/api/vales/' + encodeURIComponent(folio); }
function recordType() { return page === 'papelera' ? $('#trash-module').value : page; }
function formatDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)
        ? value.slice(0, 10).split('-').reverse().join('/') : value;
}

function actions(record, key, trash) {
    const actions = element('div', null, 'row-actions');
    actions.append(button(trash ? 'Ver / Recuperar' : canEdit(key) ? 'Ver / Editar' : 'Ver',
        () => launchEditor(key, record)));
    if (key === 'vales') {
        if (!trash && canEdit(key)) {
            if (record.estado === 'Pendiente') actions.append(button('Marcar entregado', () => openStatus(record, 'entregar')));
            actions.append(button('Anular', () => openStatus(record, 'anular'), 'danger'));
        }
        actions.append(button('Generar vale', () => generateVale(record.folio_n)));
    }
    return actions;
}

function renderRecords() {
    const key = recordType();
    if (!modules[key] && key !== 'vales') return;
    const trash = page === 'papelera';
    const search = normalize($('#search').value.trim());
    const area = $('#area').value;
    const project = $('#project').value;
    const status = $('#status').value;
    const catalog = modules[key];
    const matches = records.filter(row => {
        if (catalog) {
            return row.activo !== trash && catalog.campos.some(([field]) =>
                normalize(row[field]).includes(search));
        }
        const anulado = row.estado === 'Anulado';
        return anulado === trash && (trash || ((!area || String(row.id_area) === area)
            && (!project || String(row.id_proyecto) === project) && (!status || row.estado === status)))
            && [row.folio_n, row.solicitante, row.area, row.proyecto, row.tipo_salida]
                .some(value => normalize(value).includes(search));
    });

    const headers = catalog ? catalog.campos.map(([, label]) => label)
        : ['Folio', 'Emisión', 'Entrega', 'Área', 'Proyecto', 'Solicitante', 'Ítems', 'Estado'];
    const rows = matches.map(row => [
        ...(catalog ? catalog.campos.map(([field]) => field === 'unidad'
            && !options.unidades.some(([code]) => code === row[field]) ? row[field] + ' (revisar)' : row[field])
            : [row.folio_n, formatDate(row.fecha_emision), formatDate(row.fecha_entrega),
                row.area, row.proyecto, row.solicitante, row.total_items, badge(row.estado)]),
        actions(row, key, trash),
    ]);
    $('#record-status').textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
    const target = $('#record-table');
    target.dataset.mobileCards = String(key === 'vales');
    table(target, [...headers, 'Acciones'], rows);
}

async function loadRecords() {
    const key = recordType();
    const token = ++revision;
    records = [];
    $('#record-table').replaceChildren();
    $('#record-status').textContent = 'Cargando…';
    $('#create').disabled = true;
    try {
        const data = await request(key === 'vales' ? '/api/vales' : catalogUrl(key));
        if (token !== revision) return;
        records = data;
        if (key === 'vales' && page !== 'papelera') {
            for (const [id, label, control] of [['id_area', 'area', '#area'], ['id_proyecto', 'proyecto', '#project']]) {
                const select = $(control);
                const selected = select.value;
                const entries = [...new Map(data.filter(row => row[id] != null)
                    .map(row => [String(row[id]), row[label]])).entries()];
                entries.sort((first, second) => first[1].localeCompare(second[1], 'es'));
                listOptions(select, entries, control === '#area' ? 'Todas' : 'Todos');
                if (entries.some(([key]) => key === selected)) select.value = selected;
            }
        }
        $('#create').disabled = false;
        renderRecords();
    } catch (error) {
        if (token === revision) $('#record-status').textContent = error.message;
    }
}

function switchPage() {
    if (!user || !modules) return;
    const hash = location.hash.slice(1);
    page = Object.hasOwn(modules, hash) || ['dashboard', 'usuarios', 'vales', 'reportes', 'papelera', 'auditoria'].includes(hash)
        ? hash : 'dashboard';
    if (!canView(page)) page = 'dashboard';
    ++revision;
    clearTimeout(auditTimer);
    toggleMenu(false);
    for (const link of $('#menu').querySelectorAll('a')) {
        if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    const catalog = modules[page];
    $('#page-title').textContent = catalog?.nombre || {
        dashboard: 'Dashboard', usuarios: 'Usuarios y permisos',
        vales: 'Vales de salida', reportes: 'Reportes', papelera: 'Papelera / Inactivos',
        auditoria: 'Auditoría / Triggers',
    }[page];
    $('#page-subtitle').textContent = {
        dashboard: 'Resumen de vales y entregas según tu perfil.',
        usuarios: 'Administra los nombres de usuario, roles y credenciales de acceso.',
        vales: 'Consulta por folio, proyecto, área o solicitante.',
        reportes: 'Selecciona una consulta para revisar los movimientos de almacén.',
        papelera: 'Consulta y recupera registros inactivos.',
        auditoria: 'Cambios registrados automáticamente en PostgreSQL.',
    }[page] || '';
    message($('#notice'), '');
    $('#create').hidden = !((catalog || page === 'vales') && canEdit(page));
    $('#create').textContent = catalog?.boton || 'Nuevo vale';
    $('#records').hidden = ['dashboard', 'usuarios', 'reportes', 'auditoria'].includes(page);
    $('#dashboard').hidden = page !== 'dashboard';
    $('#users').hidden = page !== 'usuarios';
    $('#reports').hidden = page !== 'reportes';
    $('#audit').hidden = page !== 'auditoria';
    $('#trash-label').hidden = page !== 'papelera';
    $('#status-label').hidden = page !== 'vales';
    $('#area-label').hidden = page !== 'vales';
    $('#project-label').hidden = page !== 'vales';
    const example = searchExamples[recordType()];
    $('#search').placeholder = example || '';
    $('#search-help').textContent = recordType() === 'vales' ? 'Puedes combinar la búsqueda con los filtros.' : '';
    $('#search-help').hidden = !$('#search-help').textContent;
    $('#search').value = '';
    $('#status').value = '';
    $('#area').value = '';
    $('#project').value = '';
    if (!$('#records').hidden) loadRecords();
    if (page === 'auditoria') startAudit();
    if (page === 'dashboard') loadDashboard();
    if (page === 'usuarios') loadUsers();
}

function toggleMenu(open) {
    $('#menu').classList.toggle('open', open);
    $('#menu-button').setAttribute('aria-expanded', String(open));
}

function catalogLabel(key, row) {
    if (key === 'PRODUCTO') return `${row.codigo_producto} · ${row.descripcion_material}`;
    if (key === 'EMPLEADO') {
        return [row.primer_nombre, row.segundo_nombre, row.apellido_paterno, row.apellido_materno]
            .filter(Boolean).join(' ');
    }
    return row.nombre;
}

function makeField(definition, value, readonly, catalogs = {}) {
    const [key, label, type, max, required] = definition;
    const wrapper = element('label', label);
    const catalog = modules[type];
    let legacyUnit = false;
    const choices = key === 'unidad' ? options.unidades.map(([code, name]) => [code, code + ' · ' + name])
        : type === 'type' ? options.tipos.map(name => [name, name]) : null;
    const input = element(catalog || choices ? 'select' : 'input');
    input.name = key;
    input.required = required;
    if (catalog || choices) {
        const available = choices || (catalogs[type] || []).filter(row => row.activo || row[catalog.clave] === value)
            .map(row => [row[catalog.clave], catalogLabel(type, row) + (row.activo ? '' : ' (inactivo)')]);
        const hasValue = value != null && !available.some(([id]) => String(id) === String(value));
        const oldUnit = hasValue && key === 'unidad' && !readonly;
        listOptions(input, hasValue && !oldUnit ? [...available, [value, catalog ? String(value) : value + ' (anterior)']] : available, selectionPrompts[key] || 'Selecciona…');
        if (oldUnit) {
            legacyUnit = true;
            value = '';
        }
        input.disabled = readonly;
    } else {
        input.type = ['integer', 'quantity'].includes(type) ? 'number' : type;
        if (type === 'integer') {
            input.min = '1';
            input.max = '2147483647';
            input.step = '1';
        }
        if (type === 'quantity') {
            input.min = key === 'cantidad_solicitada' ? '0.001' : '0';
            input.max = '999999999.999';
            input.step = '0.001';
            input.inputMode = 'decimal';
        }
        const example = examples[key];
        if (example && !readonly) input.placeholder = example;
        if (type === 'date') input.max = datePeru.format(new Date());
        if (max) input.maxLength = max;
        input.readOnly = readonly;
        input.addEventListener('input', () => input.setCustomValidity(''));
    }
    input.value = value ?? '';
    const help = type === 'integer' ? 'Usa un número entero positivo y único.' : guidance[key];
    wrapper.append(input);
    if (help || legacyUnit) {
        const hint = element('small', (help || '') + (legacyUnit ? ' Selecciona una unidad válida para corregir el dato anterior.' : ''));
        hint.id = 'ayuda-' + ++fieldId;
        input.setAttribute('aria-describedby', hint.id);
        wrapper.append(hint);
    } else {
        wrapper.append(element('span'));
    }
    return wrapper;
}

function materialPicker(products, chosen, readonly) {
    const wrapper = element('div', null, 'material-field');
    const id = 'material-' + ++comboId;
    const label = element('label', 'Material');
    label.htmlFor = id;
    const combo = element('div', null, 'combo');
    const search = element('input');
    search.id = id;
    search.type = 'text';
    search.autocomplete = 'off';
    search.placeholder = 'Código o descripción del material';
    search.required = true;
    search.readOnly = readonly;
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-controls', id + '-lista');
    const list = element('div', null, 'combo-list');
    list.id = id + '-lista';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    let selected = chosen || '';
    let options = [];
    let index = -1;

    const possible = products.filter(product => product.activo || product.codigo_producto === chosen);
    const labelOf = p => catalogLabel('PRODUCTO', p) + (p.activo ? '' : ' (inactivo)');
    const original = possible.find(p => p.codigo_producto === chosen);
    if (original || chosen) search.value = original ? labelOf(original) : chosen;
    function close() {
        list.hidden = true;
        index = -1;
        search.setAttribute('aria-expanded', 'false');
        search.removeAttribute('aria-activedescendant');
    }
    function pick(product) {
        selected = product.codigo_producto;
        search.value = labelOf(product);
        search.setCustomValidity('');
        close();
        search.focus();
    }
    function setIndex(next) {
        if (!options.length) return;
        index = (next + options.length) % options.length;
        const buttons = list.querySelectorAll('button');
        buttons.forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
        search.setAttribute('aria-activedescendant', buttons[index].id);
        buttons[index].scrollIntoView?.({ block: 'nearest' });
    }
    function open(all = false) {
        const query = all ? '' : normalize(search.value.trim());
        options = possible.filter(p => normalize(labelOf(p)).includes(query));
        index = -1;
        search.removeAttribute('aria-activedescendant');
        const entries = options.map((p, i) => {
            const node = button(labelOf(p), () => pick(p));
            node.id = id + '-option-' + i;
            node.tabIndex = -1;
            node.setAttribute('role', 'option');
            node.setAttribute('aria-selected', 'false');
            return node;
        });
        list.replaceChildren(...(entries.length ? entries : [element('p', 'Sin coincidencias.', 'meta')]));
        list.hidden = false;
        search.setAttribute('aria-expanded', 'true');
    }
    const toggle = button('▾', () => {
        search.focus();
        if (list.hidden) open(true);
        else close();
    });
    toggle.setAttribute('aria-label', 'Mostrar lista completa de materiales');
    toggle.disabled = readonly;
    search.addEventListener('input', () => {
        selected = '';
        search.setCustomValidity('');
        open();
    });
    search.addEventListener('keydown', event => {
        if (readonly) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (list.hidden) open(true);
            setIndex(index + (event.key === 'ArrowDown' ? 1 : index < 0 ? 0 : -1));
        } else if (event.key === 'Escape' && !list.hidden) {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'Enter' && !list.hidden && options.length) {
            event.preventDefault();
            pick(options[Math.max(index, 0)]);
        }
    });
    combo.addEventListener('focusout', event => {
        if (!combo.contains(event.relatedTarget)) close();
    });
    combo.append(search, toggle, list);
    const help = element('small', 'Busca por código o descripción. La flecha abre la lista de materiales.');
    help.id = id + '-ayuda';
    search.setAttribute('aria-describedby', help.id);
    wrapper.append(label, combo, help);
    return { wrapper, search, value: () => selected };
}

function fieldset(title, definitions, data, readonly, catalogs, key) {
    const group = element('fieldset');
    group.append(element('legend', title));
    const grid = element('div', null, 'fields');
    for (const definition of definitions) {
        grid.append(makeField(definition, data?.[definition[0]],
            readonly || (Boolean(data) && definition[0] === key), catalogs));
    }
    group.append(grid);
    fields.append(group);
    return group;
}

function setupItems(data, catalogs, readonly) {
    const section = element('fieldset');
    section.append(element('legend', 'Materiales del vale'));
    const current = element('div');
    const inactive = element('div');
    const trash = element('details');
    trash.append(element('summary', 'Materiales inactivos'), inactive);
    const entries = [];
    const definitions = [
        ['cantidad_solicitada', 'Solicitada', 'quantity', 0, true],
        ['cantidad_autorizada', 'Autorizada', 'quantity', 0, true],
        ['cantidad_entregada', 'Entregada', 'quantity', 0, true],
        ['observaciones', 'Observaciones', 'text', 500, false],
    ];
    function add(data = {}) {
        const card = element('section', null, 'item');
        const inputs = element('div', null, 'fields');
        const picker = materialPicker(catalogs.PRODUCTO, data.codigo_producto, readonly);
        const controls = definitions.map(def => makeField(def,
            data[def[0]] ?? (['cantidad_autorizada', 'cantidad_entregada'].includes(def[0]) ? 0 : ''),
            readonly));
        inputs.append(picker.wrapper, ...controls);
        const entry = { data, picker, inputs, enabled: data.activo !== false };
        entries.push(entry);
        const title = element('h3', data.n_item ? `Ítem ${data.n_item}` : 'Nuevo ítem');
        const toggle = button('', () => {
            if (!data.n_item) {
                entries.splice(entries.indexOf(entry), 1);
                card.remove();
                return;
            }
            entry.enabled = !entry.enabled;
            place();
        });
        function place() {
            card.hidden = false;
            const inactiveItem = !entry.enabled;
            inputs.hidden = inactiveItem;
            for (const input of inputs.querySelectorAll('input, select, button')) {
                input.disabled = inactiveItem || readonly;
            }
            toggle.textContent = inactiveItem ? 'Recuperar material' : 'Enviar material a inactivos';
            toggle.className = inactiveItem ? '' : 'danger';
            (inactiveItem ? inactive : current).append(card);
            trash.hidden = !inactive.childElementCount;
        }
        const product = catalogs.PRODUCTO.find(p => p.codigo_producto === data.codigo_producto);
        const inactiveLabel = element('p', product ? catalogLabel('PRODUCTO', product) : data.codigo_producto);
        const syncLabel = () => { inactiveLabel.hidden = entry.enabled; };
        toggle.addEventListener('click', syncLabel);
        card.append(title, inactiveLabel, inputs, toggle);
        toggle.hidden = readonly;
        place();
        if (!data.n_item) toggle.textContent = 'Quitar material';
        syncLabel();
    }
    section.append(current, trash);
    if (!readonly && data) section.append(element('p', 'Guarda el vale para aplicar las altas, bajas o recuperaciones de sus materiales.', 'meta'));
    if (!readonly) section.append(button('Agregar material', () => add()));
    fields.append(section);
    const items = data?.items ?? [{}];
    for (const item of items) add(item);
    trash.hidden = !inactive.childElementCount;
    return entries;
}

function signaturePanel(data, readonly) {
    const group = element('fieldset');
    group.append(element('legend', 'Firmas manuscritas'));
    group.append(element('p', 'Opcional. Dibuja con el mouse, el dedo o el lápiz. Si aún no ha firmado, deja el recuadro vacío.', 'meta'));
    const grid = element('div', null, 'fields');
    group.append(grid);
    fields.append(group);
    return signatures.map(([key, label]) => {
        const card = element('div', null, 'signature-card');
        card.append(element('h3', label));
        let value = data?.[key] ?? null;
        let drawn = false;
        const validImage = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
        const hint = element('p', null, 'meta');
        function describe() {
            hint.textContent = value && !validImage.test(value)
                ? 'Este vale contiene una anotación anterior en este campo. Puedes reemplazarla dibujando la firma.'
                : value || drawn ? 'Firma capturada.' : 'Firma pendiente.';
        }
        describe();
        const original = element('img');
        original.alt = label + ' guardada';
        original.hidden = !value || !validImage.test(value);
        if (!original.hidden) original.src = value;
        card.append(original);

        if (!readonly) {
            const pad = element('canvas', 'Superficie para dibujar la firma.', 'signature-pad');
            pad.width = 480;
            pad.height = 160;
            pad.setAttribute('aria-label', label + ': superficie de dibujo');
            let pointer = null;
            let context;
            function point(event) {
                const rect = pad.getBoundingClientRect();
                return [(event.clientX - rect.left) * pad.width / rect.width,
                    (event.clientY - rect.top) * pad.height / rect.height];
            }
            pad.addEventListener('pointerdown', event => {
                if (event.button !== 0 || pointer !== null) return;
                event.preventDefault();
                context = pad.getContext('2d');
                if (!context) return;
                pointer = event.pointerId;
                pad.setPointerCapture?.(pointer);
                if (!drawn) {
                    value = null;
                    original.hidden = true;
                }
                const [x, y] = point(event);
                context.strokeStyle = '#163e32';
                context.fillStyle = '#163e32';
                context.lineWidth = 2.5;
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.beginPath();
                context.arc(x, y, 1.25, 0, Math.PI * 2);
                context.fill();
                context.beginPath();
                context.moveTo(x, y);
                drawn = true;
                describe();
            });
            pad.addEventListener('pointermove', event => {
                if (event.pointerId !== pointer) return;
                const [x, y] = point(event);
                context.lineTo(x, y);
                context.stroke();
                context.beginPath();
                context.moveTo(x, y);
            });
            for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
                pad.addEventListener(eventName, event => {
                    if (event.pointerId === pointer) pointer = null;
                });
            }
            const clear = button('Limpiar', () => {
                value = null;
                drawn = false;
                original.hidden = true;
                context?.clearRect(0, 0, pad.width, pad.height);
                describe();
            });
            clear.setAttribute('aria-label', 'Limpiar ' + label.toLowerCase());
            card.append(pad, clear);
            grid.append(card);
            card.append(hint);
            return { key, value: () => drawn ? pad.toDataURL('image/png') : value };
        }
        grid.append(card);
        card.append(hint);
        return { key, value: () => value };
    });
}

async function launchEditor(key, record) {
    if (dialog.open || busy) return;
    const token = revision;
    busy = true;
    try {
        const catalog = modules[key];
        const data = !catalog && record ? await request(valeUrl(record.folio_n)) : record;
        const archived = Boolean(data && (catalog ? !data.activo : data.anulado_en));
        const readonly = archived || !canEdit(key);
        const related = catalog || user.rol === 'cliente' ? { PRODUCTO: [] } : Object.fromEntries(await Promise.all(
            Object.keys(modules).map(async k => [k, await request(catalogUrl(k))])));
        if (token !== revision) return;
        fields.replaceChildren();
        message($('#edit-message'), '');
        const label = catalog?.singular || 'vale';
        $('#editor-title').textContent = data ? `${readonly ? 'Consultar' : 'Editar'} ${label}`
            : (catalog?.boton || 'Nuevo vale');
        const primary = catalog ? catalog.clave : 'folio_n';
        // Dates from the detail endpoint include PostgreSQL's date-only representation.
        // The raw timestamps would empty an HTML date input or shift the calendar day.
        const formValues = !catalog && data ? {
            ...data, fecha_emision: data.emision_iso, fecha_entrega: data.entrega_iso,
        } : data;
        const main = fieldset('Datos generales', catalog?.campos || primaryFields, formValues, readonly, related, primary);
        const entries = catalog ? [] : setupItems(data, related, readonly);
        const signers = !catalog && user.rol !== 'cliente' ? signaturePanel(data, readonly) : [];
        editorState = { key, data, readonly, main, entries, primary, signers };
        $('#save').hidden = readonly;
        $('#print-vale').hidden = catalog || !data;
        $('#deliver-vale').hidden = Boolean(catalog || !data || readonly || data.fecha_entrega);
        if (!catalog && data?.anulado_en) {
            fields.prepend(element('p', 'Motivo de anulación: ' + (data.motivo_anulacion || 'Sin motivo registrado.'), 'notice'));
        }
        const transition = $('#transition');
        transition.hidden = !data || (archived ? user.rol !== 'admin' : !canEdit(key));
        transition.textContent = archived ? 'Recuperar' : catalog ? 'Enviar a papelera' : 'Anular vale';
        transition.classList.toggle('danger', !archived);
        dialog.showModal();
    } catch (error) {
        message($('#notice'), error.message, true);
    } finally {
        busy = false;
    }
}

function collect(parent) {
    return Object.fromEntries(Array.from(parent.querySelectorAll('input[name], select[name]'), input =>
        [input.name, input.value.trim() || null]));
}

function validateAndCollect(state) {
    const data = collect(state.main);
    for (const field of state.main.querySelectorAll('[required]')) {
        if (!field.value.trim()) throw new Error(`Completa el campo «${field.parentElement.firstChild.textContent}».`);
    }
    const key = data[state.primary];
    if (key?.includes('/')) throw new Error('El código o folio no puede contener barras.');
    const numericKey = modules[state.key]?.campos[0][2] === 'integer';
    const compareKey = value => numericKey ? Number(value) : String(value ?? '').trim().toLowerCase();
    if (!state.data && records.some(row => compareKey(row[state.primary]) === compareKey(key))) {
        throw new Error('Ese identificador ya existe. Revisa también la papelera.');
    }
    if (state.key !== 'vales') return data;
    for (const signer of state.signers) data[signer.key] = signer.value();
    const today = datePeru.format(new Date());
    if (data.fecha_emision > today) throw new Error('La fecha de emisión no puede ser futura.');
    if (data.fecha_entrega > today) throw new Error('La fecha de entrega no puede ser futura.');
    if (data.fecha_entrega && data.fecha_entrega < data.fecha_emision) {
        throw new Error('La fecha de entrega no puede ser anterior a la fecha de emisión.');
    }
    data.items = state.entries.filter(entry => entry.enabled).map((entry, index) => {
        const item = collect(entry.inputs);
        item.codigo_producto = entry.picker.value();
        if (!item.codigo_producto) {
            entry.picker.search.focus();
            throw new Error(`Ítem ${index + 1}: selecciona un material de la lista.`);
        }
        const numbers = [item.cantidad_solicitada, item.cantidad_autorizada, item.cantidad_entregada];
        const [requested, authorized, delivered] = numbers.map(Number);
        if (numbers.some(value => value === null || !Number.isFinite(Number(value)))
            || requested <= 0 || authorized < 0 || delivered < 0) {
            throw new Error(`Ítem ${index + 1}: la solicitada debe ser positiva y ninguna cantidad puede ser negativa.`);
        }
        if (authorized > requested || delivered > authorized) {
            throw new Error(`Ítem ${index + 1}: se requiere entregada ≤ autorizada ≤ solicitada.`);
        }
        if (entry.data.n_item) item.n_item = entry.data.n_item;
        return item;
    });
    if (!data.items.length) throw new Error('Agrega al menos un material activo.');
    if (data.items.length > 1000) throw new Error('El máximo es de 1000 materiales por vale.');
    return data;
}

async function mutate(path, method, data, confirmation) {
    if (busy) return;
    busy = true;
    const controls = [$('#save'), $('#transition'), $('#close')];
    controls.forEach(control => { control.disabled = true; });
    message($('#edit-message'), '');
    try {
        await request(path, method, data);
        dialog.close();
        await reloadValeViews();
        message($('#notice'), confirmation);
    } catch (error) {
        message($('#edit-message'), error.message, true);
    } finally {
        controls.forEach(control => { control.disabled = false; });
        busy = false;
    }
}

form.addEventListener('invalid', event => {
    const field = event.target;
    const label = field.labels?.[0]?.firstChild?.textContent || 'este campo';
    message($('#edit-message'), `Revisa «${label}». ${field.validationMessage}`, true);
}, true);
form.addEventListener('submit', event => {
    event.preventDefault();
    const state = editorState;
    if (state.readonly || busy) return;
    try {
        const data = validateAndCollect(state);
        const base = state.key === 'vales' ? '/api/vales' : catalogUrl(state.key);
        const path = state.data ? base + '/' + encodeURIComponent(state.data[state.primary]) : base;
        mutate(path, state.data ? 'PUT' : 'POST', data, 'Cambios guardados.');
    } catch (error) {
        message($('#edit-message'), error.message, true);
    }
});
$('#transition').addEventListener('click', () => {
    const { key, data, primary, readonly } = editorState;
    const id = data[primary];
    const action = readonly ? 'recuperar' : key === 'vales' ? 'anular' : 'inactivar';
    if (!readonly && key === 'vales') return openStatus(data, 'anular');
    if (!window.confirm(readonly ? `¿Recuperar ${id}?` : `¿Enviar ${id} a la papelera?`)) return;
    const base = key === 'vales' ? valeUrl(id) : catalogUrl(key) + '/' + encodeURIComponent(id);
    mutate(base + '/' + action, 'POST', {}, readonly ? 'Registro recuperado.' : 'Registro enviado a la papelera.');
});
$('#close').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

function renderAudit() {
    const tab = $('#audit-table-filter').value;
    const action = $('#audit-action-filter').value;
    const rows = audit.filter(row => (!tab || row.tabla === tab) && (!action || row.accion === action));
    table($('#audit-table'), ['Fecha y hora (Perú)', 'Tabla', 'Acción', 'Registro', 'Detalle'],
        rows.map(row => {
            const detail = element('details');
            detail.dataset.id = row.id;
            detail.append(element('summary', 'Ver cambios'), element('pre', JSON.stringify(row.detalle, (key, value) => key.startsWith('firma_') && typeof value === 'string' && value.startsWith('data:image/png;') ? '[Firma manuscrita registrada]' : value, 2)));
            return [timePeru.format(new Date(row.fecha_hora)), row.tabla, badge(row.accion), row.registro, detail];
        }), 'No hay movimientos para los filtros de esta página.');
    $('#audit-message').textContent = `${rows.length} de ${audit.length} movimientos · ${auditBefore ? 'Página anterior' : 'Actualización automática cada 2 segundos'}`;
    $('#audit-new').hidden = !auditBefore;
    $('#audit-older').disabled = audit.length < 100;
}

async function refreshAudit(token) {
    const before = auditBefore;
    try {
        const data = await request('/api/auditoria' + (before ? '?antes=' + before : ''));
        if (token !== revision || before !== auditBefore) return;
        if (JSON.stringify(data) !== JSON.stringify(audit) || !$('#audit-table').childElementCount) {
            const expanded = new Set(Array.from($('#audit-table').querySelectorAll('details[open]'), node => node.dataset.id));
            audit = data;
            renderAudit();
            for (const detail of $('#audit-table').querySelectorAll('details')) {
                if (expanded.has(detail.dataset.id)) detail.open = true;
            }
        }
    } catch (error) {
        if (token === revision) $('#audit-message').textContent = error.message;
    } finally {
        if (token === revision && !auditBefore) auditTimer = setTimeout(() => refreshAudit(token), 2000);
    }
}

function startAudit(before = null) {
    clearTimeout(auditTimer);
    auditBefore = before;
    audit = [];
    $('#audit-table').replaceChildren();
    $('#audit-message').textContent = 'Cargando movimientos…';
    $('#audit-older').disabled = true;
    refreshAudit(++revision);
}

$('#audit-older').addEventListener('click', () => startAudit(audit.at(-1)?.id));
$('#audit-new').addEventListener('click', () => startAudit());
$('#audit-table-filter').addEventListener('change', renderAudit);
$('#audit-action-filter').addEventListener('change', renderAudit);
$('#menu-button').addEventListener('click', () => toggleMenu(!$('#menu').classList.contains('open')));
$('#create').addEventListener('click', () => launchEditor(recordType()));
$('#search').addEventListener('input', renderRecords);
$('#area').addEventListener('change', renderRecords);
$('#project').addEventListener('change', renderRecords);
$('#status').addEventListener('change', renderRecords);
$('#trash-module').addEventListener('change', () => { $('#search').value = ''; switchPage(); });

$('#report-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('#run-report').disabled = true;
    $('#report-table').replaceChildren();
    $('#report-message').textContent = 'Ejecutando…';
    try {
        const data = await request('/api/reportes/' + $('#report').value);
        table($('#report-table'), data.columns.map(name => name.replaceAll('_', ' ')),
            data.rows.map(row => data.columns.map(key => formatDate(row[key]))), 'La consulta no devolvió filas.');
        $('#report-message').textContent = `${data.rows.length} resultados`;
    } catch (error) {
        $('#report-message').textContent = error.message;
    } finally {
        $('#run-report').disabled = false;
    }
});

function canView(key) {
    if (user.rol === 'admin') return true;
    if (user.rol === 'cliente') return key === 'vales' || key === 'dashboard';
    return !['papelera', 'auditoria', 'usuarios'].includes(key);
}

function canEdit(key) {
    return user.rol === 'admin' || (user.rol === 'operador' && key === 'vales');
}

function showSession(session) {
    user = session;
    $('#login').hidden = Boolean(session);
    $('#workspace').hidden = !session;
    for (const selector of ['#logout', '#account', '#connection', '#menu-button']) $(selector).hidden = !session;
    if (!session) {
        ++revision;
        clearTimeout(auditTimer);
        $('#login-form').reset();
        togglePassword($('#login-password'), $('#show-password'), false);
        if (dialog.open) dialog.close();
        fields.replaceChildren();
        if ($('#user-editor').open) $('#user-editor').close();
        for (const id of ['#status-dialog', '#dashboard-detail', '#vale-print']) if ($(id).open) $(id).close();
        $('#dashboard-content').replaceChildren();
        $('#user-table').replaceChildren();
        $('#record-table').replaceChildren();
        $('#audit-table').replaceChildren();
        $('#report-table').replaceChildren();
        editorState = null;
        records = [];
        audit = [];
        auditBefore = null;
        return;
    }
    $('#account').textContent = session.nombre + ' · ' + session.etiqueta;
    for (const link of $('#menu').querySelectorAll('a')) link.hidden = !canView(link.hash.slice(1));
    for (const label of $('#menu').querySelectorAll('p')) label.hidden = !Array.from($('#menu a')).some(link =>
        !link.hidden && link.previousElementSibling === label);
    switchPage();
    request('/api/prueba-conexion').then(() => {
        $('#connection').textContent = 'PostgreSQL conectado';
        $('#connection').dataset.state = 'ok';
    }).catch(() => { $('#connection').textContent = 'PostgreSQL sin conexión'; });
    if (canView('reportes')) request('/api/reportes').then(reports => listOptions($('#report'),
        reports.map(report => [report.id, report.nombre]), 'Selecciona…'))
        .catch(error => { $('#report-message').textContent = error.message; });
}

$('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const loginForm = event.currentTarget;
    $('#login-submit').disabled = true;
    message($('#login-message'), '');
    try {
        if (!modules) throw new Error('Recarga la página para cargar la configuración de ValesTrack.');
        showSession(await request('/api/login', 'POST', {
            usuario: loginForm.elements.usuario.value,
            contrasena: loginForm.elements.contrasena.value,
        }));
        loginForm.reset();
    } catch (error) {
        message($('#login-message'), error.message, true);
    } finally {
        $('#login-submit').disabled = false;
    }
});

$('#logout').addEventListener('click', async () => {
    try {
        await request('/api/logout', 'POST');
        showSession(null);
    } catch (error) {
        message($('#notice'), error.message, true);
    }
});

async function initialize() {
    try {
        [modules, options] = await Promise.all([request('/modulos.json'), request('/opciones.json')]);
        const choices = Object.entries(modules).map(([key, config]) => [key, config.nombre]);
        listOptions($('#trash-module'), [['vales', 'Vales de salida'], ...choices], 'Selecciona…');
        $('#trash-module').options[0].remove();
        $('#trash-module').value = 'vales';
        listOptions($('#audit-table-filter'), [...Object.entries(names), ...choices], 'Todas');
        window.addEventListener('hashchange', switchPage);
        showSession((await request('/api/sesion')).usuario);
        $('#login-submit').disabled = false;
    } catch (error) {
        message($('#login-message'), error.message, true);
    }
}

document.addEventListener('DOMContentLoaded', initialize, { once: true });
