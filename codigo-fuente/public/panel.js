'use strict';

let dashboardRequest = 0;
let userRows = [];
let userEdit = null;
let accountSaving = false;
const numbers = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 });

function metric(container, label, value, description, action) {
    const card = element('article', null, 'panel metric');
    card.append(element('p', label), element('strong', value == null ? '—' : numbers.format(value)),
        element('small', description));
    if (action) {
        const link = button('Ver detalle', action, 'metric-link');
        link.setAttribute('aria-label', 'Ver detalle: ' + label);
        card.append(link);
        card.classList.add('metric-interactive');
        card.addEventListener('click', event => {
            if (!event.target.closest('button') && !window.getSelection()?.toString()) action();
        });
    }
    container.append(card);
}

function dashboardCard(title, content, description) {
    const card = element('article', null, 'panel dashboard-card');
    card.append(element('h2', title));
    if (description) card.append(element('p', description, 'meta'));
    card.append(content);
    return card;
}

function dashboardTable(title, headers, rows, description, action) {
    const content = element('div', null, 'scroll dashboard-table');
    table(content, headers, rows);
    const card = dashboardCard(title, content, description);
    if (action) card.append(button('Ver todo', action, 'metric-link'));
    return card;
}

function distribution(data) {
    const content = element('div', null, 'distribution');
    const total = Math.max(data.vigentes, 1);
    const meter = element('div', null, 'distribution-meter');
    const done = element('span', null, 'is-delivered');
    const pending = element('span', null, 'is-pending');
    done.style.width = data.entregados * 100 / total + '%';
    pending.style.width = data.pendientes * 100 / total + '%';
    meter.setAttribute('aria-hidden', 'true');
    meter.append(done, pending);
    const labels = element('div', null, 'distribution-labels');
    labels.append(button(numbers.format(data.entregados) + ' entregados',
        () => openDashboardDetail('entregados', 'Vales entregados'), 'distribution-button'),
        button(numbers.format(data.pendientes) + ' pendientes',
            () => openDashboardDetail('pendientes', 'Vales pendientes'), 'distribution-button'));
    content.append(meter, labels);
    return dashboardCard('Estado de entregas', content, 'Un vale cuenta como entregado cuando tiene fecha de entrega.');
}

function trend(data) {
    const content = element('div', null, 'scroll');
    const list = element('ol', null, 'trend');
    const max = Math.max(1, ...data.tendencia.map(row => row.total));
    for (const row of data.tendencia) {
        const first = formatDate(row.inicio).slice(0, 5);
        const last = formatDate(row.fin).slice(0, 5);
        const date = first === last ? first : first + '–' + last;
        const item = element('li');
        item.setAttribute('aria-label', `${date}: ${row.total} vales`);
        const bar = element('div', null, 'trend-bar');
        bar.style.height = (row.total / max * 100) + '%';
        const plot = element('div', null, 'trend-plot');
        plot.append(bar);
        const control = button(row.total, () => openDashboardDetail('vigentes',
            'Vales emitidos · ' + date, row.inicio, row.fin), 'trend-action');
        control.setAttribute('aria-label', `Ver ${row.total} vales del período ${date}`);
        item.append(control, plot, element('small', date));
        list.append(item);
    }
    content.append(list);
    return dashboardCard('Vales emitidos en el tiempo', content, 'Vales vigentes agrupados por su fecha de emisión.');
}

function renderDashboard(data) {
    const content = $('#dashboard-content');
    const cards = element('div', null, 'metrics');
    metric(cards, 'Vales vigentes', data.vigentes, 'Emitidos durante el período.', detail('vigentes', 'Vales vigentes'));
    metric(cards, 'Entregados', data.entregados, data.vigentes
        ? numbers.format(data.entregados * 100 / data.vigentes) + '% de los vales vigentes.'
        : 'Sin vales vigentes en este período.', detail('entregados', 'Vales entregados'));
    metric(cards, 'Pendientes', data.pendientes, 'Sin fecha de entrega registrada.', detail('pendientes', 'Vales pendientes'));
    if (data.anulados !== undefined) metric(cards, 'Anulados', data.anulados, 'Emitidos durante el período.', detail('anulados', 'Vales anulados'));
    if (data.pendientes_7 !== undefined) {
        metric(cards, 'Pendientes por 7 días o más', data.pendientes_7, 'Desde su fecha de emisión.', detail('antiguos', 'Pendientes por 7 días o más'));
        metric(cards, 'Líneas con saldo por entregar', data.lineas_pendientes, 'De ' + numbers.format(data.lineas) + ' líneas activas.', detail('lineas', 'Líneas con saldo por entregar'));
        metric(cards, 'Tiempo medio de entrega', data.demora, 'Días entre emisión y entrega registrada.', detail('entregados', 'Tiempos de entrega por vale'));
    }

    const charts = element('div', null, 'dashboard-grid charts');
    charts.append(trend(data), distribution(data));
    const tables = element('div', null, 'dashboard-grid dashboard-tables');
    tables.append(dashboardTable('Vales recientes', ['Folio', 'Emisión', 'Proyecto', 'Estado'],
        data.recientes.map(row => [valeLink(row), formatDate(row.fecha_emision), row.proyecto, badge(row.estado)]),
        null, detail('vigentes', 'Vales vigentes')));
    if (data.cola) {
        tables.append(dashboardTable('Pendientes más antiguos', ['Folio', 'Área', 'Proyecto', 'Días'],
            data.cola.map(row => [valeLink(row), row.area, row.proyecto, row.dias]),
            null, detail('pendientes', 'Vales pendientes')));
    }
    if (data.areas && data.proyectos) {
        for (const [title, rows, type] of [['Vales por área', data.areas, 'areas'], ['Vales por proyecto', data.proyectos, 'proyectos']]) {
            tables.append(dashboardTable(title, ['Nombre', 'Vales', 'Pendientes'],
                rows.map(row => [row.nombre, row.total, row.pendientes]), null, detail(type, title)));
        }
    }
    if (data.materiales) {
        tables.append(dashboardTable('Materiales con mayor movimiento', ['Código', 'Material', 'Vales', 'Saldo pendiente', 'Unidad'],
            data.materiales.map(row => [row.codigo, row.material, row.vales, numbers.format(row.pendiente), row.unidad]),
            'Ordenado por número de vales. El saldo se muestra en la unidad de cada material.', detail('materiales', 'Materiales con mayor movimiento')));
    }
    if (data.actividad) {
        tables.append(dashboardTable('Actividad reciente', ['Acción', 'Tabla', 'Registro', 'Fecha y hora'],
            data.actividad.map(row => [row.accion, row.tabla, row.registro, timePeru.format(new Date(row.fecha_hora))]),
            'Últimos cambios de auditoría de toda la base.', go('auditoria')));
    }
    content.replaceChildren(cards, charts, tables);
    if (data.empleados !== undefined) {
        const catalog = element('div', null, 'metrics');
        for (const [label, value, description, action] of [
            ['Empleados', data.empleados, 'Activos', go('EMPLEADO')],
            ['Materiales', data.productos, 'Activos', go('PRODUCTO')],
            ['Áreas', data.areas_activas, 'Activas', go('AREA')],
            ['Proyectos', data.proyectos_activos, 'Activos', go('PROYECTO')],
            ['Vales en papelera', data.papelera, 'Total histórico', detail('papelera', 'Vales en papelera')],
        ]) metric(catalog, label, value, description, action);
        content.append(dashboardCard('Catálogos y papelera', catalog, 'Estado actual, independiente del período.'));
    }
}

function detail(type, title) { return () => openDashboardDetail(type, title); }
function go(target) { return () => { location.hash = target; }; }
function valeLink(row) {
    return button(row.folio_n, () => launchEditor('vales', row), 'metric-link row-link');
}

let dashboardSelection;
let detailRequest = 0;
function openDashboardDetail(type, title, start, end) {
    dashboardSelection = { type, start, end, dias: $('#dashboard-period').value };
    $('#dashboard-detail-title').textContent = title;
    if (!$('#dashboard-detail').open) $('#dashboard-detail').showModal();
    refreshDashboardDetail();
}

async function refreshDashboardDetail() {
    const token = ++detailRequest;
    const { type, dias, start, end } = dashboardSelection;
    const status = $('#dashboard-detail-status');
    const target = $('#dashboard-detail-table');
    const query = new URLSearchParams({ tipo: type, dias });
    if (start) query.set('inicio', start);
    if (end) query.set('fin', end);
    status.textContent = 'Cargando detalle…';
    target.replaceChildren();
    try {
        const data = await request('/api/dashboard/detalle?' + query);
        if (token !== detailRequest || !$('#dashboard-detail').open || !user) return;
        status.textContent = `${data.length} ${data.length === 1 ? 'registro' : 'registros'}`;
        if (type === 'lineas' || type === 'materiales') {
            const byLine = type === 'lineas';
            table(target, [byLine ? 'Folio' : 'Código', 'Material', byLine ? 'Ítem' : 'Vales', 'Saldo', 'Unidad'],
                data.map(row => [byLine ? valeLink(row) : row.codigo, row.material,
                    byLine ? row.n_item : row.vales, numbers.format(row.saldo), row.unidad]));
        } else if (type === 'areas' || type === 'proyectos') {
            table(target, ['Nombre', 'Vales', 'Pendientes'], data.map(row => [row.nombre, row.total, row.pendientes]));
        } else {
            table(target, ['Folio', 'Emisión', 'Entrega', 'Área', 'Proyecto', 'Estado', 'Días hasta entrega', 'Acciones'],
                data.map(row => [valeLink(row), formatDate(row.fecha_emision), formatDate(row.fecha_entrega),
                    row.area, row.proyecto, badge(row.estado), row.dias, button('Generar vale', () => generateVale(row.folio_n))]));
        }
    } catch (error) {
        if (token === detailRequest && $('#dashboard-detail').open) status.textContent = error.message;
    }
}

$('#dashboard-detail-close').addEventListener('click', () => $('#dashboard-detail').close());

async function loadDashboard() {
    const token = ++dashboardRequest;
    const status = $('#dashboard-status');
    const period = $('#dashboard-period').value;
    status.textContent = 'Cargando indicadores…';
    $('#dashboard-content').replaceChildren();
    $('#dashboard-refresh').disabled = true;
    try {
        const data = await request('/api/dashboard?dias=' + period);
        if (token !== dashboardRequest || page !== 'dashboard' || !user) return;
        status.textContent = `${formatDate(data.inicio)} al ${formatDate(data.fin)} · Fecha de emisión`;
        renderDashboard(data);
    } catch (error) {
        if (token === dashboardRequest && page === 'dashboard') status.textContent = error.message;
    } finally {
        if (token === dashboardRequest) $('#dashboard-refresh').disabled = false;
    }
}

function renderUsers() {
    const query = normalize($('#user-search').value.trim());
    const rows = userRows.filter(row => [row.usuario, row.nombre, row.etiqueta].some(value =>
        normalize(value).includes(query)));
    $('#user-status').textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
    table($('#user-table'), ['Usuario', 'Nombre', 'Rol', 'Acciones'], rows.map(row =>
        [row.usuario, row.nombre, badge(row.etiqueta), button('Editar cuenta', () => editAccount(row))]));
}

async function loadUsers() {
    const actor = user;
    const token = revision;
    $('#user-status').textContent = 'Cargando cuentas…';
    $('#user-table').replaceChildren();
    try {
        const data = await request('/api/usuarios');
        if (actor !== user || token !== revision || page !== 'usuarios') return;
        userRows = data;
        renderUsers();
    } catch (error) {
        if (actor === user && token === revision) $('#user-status').textContent = error.message;
    }
}

function editAccount(row) {
    if (accountSaving) return;
    userEdit = row || null;
    const form = $('#user-form');
    form.reset();
    form.elements.usuario.value = row?.usuario || '';
    form.elements.nombre.value = row?.nombre || '';
    form.elements.rol.value = row?.rol || 'cliente';
    togglePassword(form.elements.contrasena, $('#user-show-password'), false);
    $('#user-editor-title').textContent = row ? 'Editar cuenta' : 'Nueva cuenta';
    $('#user-password-help').textContent = row
        ? 'Deja este campo vacío para conservar la contraseña. Usa al menos 12 caracteres para cambiarla.'
        : 'Usa al menos 12 caracteres o deja el campo vacío para generar la contraseña.';
    message($('#user-editor-message'), '');
    $('#user-editor').showModal();
}

function togglePassword(input, control, visible = input.type === 'password') {
    input.type = visible ? 'text' : 'password';
    control.textContent = visible ? 'Ocultar' : 'Mostrar';
    control.setAttribute('aria-pressed', String(visible));
}

$('#dashboard-period').addEventListener('change', loadDashboard);
$('#dashboard-refresh').addEventListener('click', loadDashboard);
$('#user-search').addEventListener('input', renderUsers);
$('#user-create').addEventListener('click', () => editAccount());
$('#user-close').addEventListener('click', () => $('#user-editor').close());
$('#user-editor').addEventListener('cancel', event => { if (accountSaving) event.preventDefault(); });
$('#show-password').addEventListener('click', event => togglePassword($('#login-password'), event.currentTarget));
$('#user-show-password').addEventListener('click', event =>
    togglePassword($('#user-form').elements.contrasena, event.currentTarget));
$('#user-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (accountSaving) return;
    const controls = event.currentTarget.elements;
    accountSaving = true;
    $('#user-close').disabled = true;
    $('#user-save').disabled = true;
    message($('#user-editor-message'), '');
    try {
        const result = await request('/api/usuarios' + (userEdit ? '/' + encodeURIComponent(userEdit.usuario) : ''),
            userEdit ? 'PUT' : 'POST', {
                usuario: controls.usuario.value, nombre: controls.nombre.value,
                rol: controls.rol.value, contrasena: controls.contrasena.value,
            });
        controls.contrasena.value = '';
        $('#user-editor').close();
        if (result.volver_a_ingresar) {
            showSession(null);
            message($('#login-message'), 'Tu cuenta fue actualizada. Vuelve a iniciar sesión.');
        } else {
            await loadUsers();
            message($('#notice'), 'Cuenta guardada.');
        }
        if (result.contrasena) {
            $('#issued-password').value = result.contrasena;
            $('#new-password').showModal();
        }
    } catch (error) {
        message($('#user-editor-message'), error.message, true);
    } finally {
        accountSaving = false;
        $('#user-close').disabled = false;
        $('#user-save').disabled = false;
    }
});
$('#copy-password').addEventListener('click', async () => {
    const field = $('#issued-password');
    field.select();
    try {
        await navigator.clipboard.writeText(field.value);
        $('#copy-password').textContent = 'Copiada';
    } catch {
        field.focus();
    }
});
$('#finish-password').addEventListener('click', () => $('#new-password').close());
$('#new-password').addEventListener('close', () => {
    $('#issued-password').value = '';
    $('#copy-password').textContent = 'Copiar';
});
