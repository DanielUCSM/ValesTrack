'use strict';

const themeKey = 'valestrack-theme';
function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const control of document.querySelectorAll('#theme-toggle, .dialog-theme')) {
        control.textContent = dark ? 'Modo claro' : 'Modo oscuro';
        control.setAttribute('aria-pressed', String(dark));
    }
}
function toggleTheme() {
    const dark = document.documentElement.dataset.theme !== 'dark';
    applyTheme(dark);
    try { localStorage.setItem(themeKey, dark ? 'dark' : 'light'); } catch {}
}
for (const header of document.querySelectorAll('dialog .dialog-head')) {
    header.append(button('Modo oscuro', toggleTheme, 'quiet dialog-theme'));
}
try { applyTheme(localStorage.getItem(themeKey) === 'dark'); } catch { applyTheme(false); }
$('#theme-toggle').addEventListener('click', toggleTheme);

let nextStatus;
let statusInProgress = false;
function openStatus(record, action) {
    if (statusInProgress) return;
    const delivery = action === 'entregar';
    const form = $('#status-form');
    nextStatus = { record, action, delivery };
    form.reset();
    const today = datePeru.format(new Date());
    form.elements.fecha.value = today;
    form.elements.fecha.max = today;
    form.elements.fecha.min = record.emision_iso || record.fecha_emision?.slice(0, 10) || '';
    form.elements.fecha.required = delivery;
    form.elements.fecha.disabled = !delivery;
    form.elements.motivo.required = !delivery;
    form.elements.motivo.disabled = delivery;
    $('#delivery-date-label').hidden = !delivery;
    $('#cancel-reason-label').hidden = delivery;
    $('#status-title').textContent = (delivery ? 'Marcar como entregado · ' : 'Anular vale · ') + record.folio_n;
    $('#status-description').textContent = delivery
        ? 'Confirma la fecha. Las cantidades registradas se conservan. Si fueron distintas, actualízalas primero en el vale.'
        : 'El vale se moverá a la papelera. Su motivo quedará en el vale y en auditoría.';
    $('#status-submit').textContent = delivery ? 'Confirmar entrega' : 'Confirmar anulación';
    message($('#status-message'), '');
    $('#status-dialog').showModal();
}

async function reloadValeViews() {
    if (page === 'dashboard') {
        await loadDashboard();
        if ($('#dashboard-detail').open) await refreshDashboardDetail();
    } else if (page === 'vales' || page === 'papelera' || modules[page]) {
        await loadRecords();
    }
}

$('#deliver-vale').addEventListener('click', () => openStatus(editorState.data, 'entregar'));
$('#print-vale').addEventListener('click', () => generateVale(editorState.data.folio_n));
$('#status-close').addEventListener('click', () => $('#status-dialog').close());
$('#status-dialog').addEventListener('cancel', event => { if (statusInProgress) event.preventDefault(); });
$('#status-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (statusInProgress || !nextStatus) return;
    const { record, action, delivery } = nextStatus;
    const controls = event.currentTarget.elements;
    const data = delivery ? { fecha: controls.fecha.value } : { motivo: controls.motivo.value.trim() };
    if (!delivery && !data.motivo) {
        message($('#status-message'), 'Escribe el motivo de anulación.', true);
        return;
    }
    statusInProgress = true;
    $('#status-close').disabled = true;
    $('#status-submit').disabled = true;
    try {
        await request(valeUrl(record.folio_n) + '/' + action, 'POST', data);
        $('#status-dialog').close();
        if (dialog.open) dialog.close();
        await reloadValeViews();
        message($('#notice'), delivery ? 'Entrega registrada.' : 'Vale anulado y enviado a la papelera.');
    } catch (error) {
        message($('#status-message'), error.message, true);
    } finally {
        statusInProgress = false;
        $('#status-close').disabled = false;
        $('#status-submit').disabled = false;
    }
});

let printLoading = false;
let printablePages = [];
let printableFolio = '';
let printableUrl;

async function generateVale(folio) {
    if (printLoading) return;
    printLoading = true;
    const token = user;
    try {
        const data = await request(valeUrl(folio));
        const pages = await makeValeDocument(data);
        if (user !== token) return;
        printablePages = pages;
        printableFolio = data.folio_n;
        const previews = pages.map(page => {
            const preview = element('img', null, 'vale-paper');
            preview.alt = 'Vista previa del vale ' + printableFolio;
            preview.loading = 'lazy';
            preview.width = page.width;
            preview.height = page.height;
            preview.src = page.source;
            return preview;
        });
        message($('#print-error'), '');
        $('#print-content').replaceChildren(...previews);
        $('#vale-print').showModal();
    } catch (error) {
        if (dialog.open) message($('#edit-message'), error.message, true);
        else if ($('#dashboard-detail').open) $('#dashboard-detail-status').textContent = error.message;
        else message($('#notice'), error.message, true);
    } finally {
        printLoading = false;
    }
}

function openValePdf(download) {
    if (!printablePages.length) return;
    try {
        if (!printableUrl) {
            const pdf = new Blob(valePdfBytes(printablePages), { type: 'application/pdf' });
            printableUrl = URL.createObjectURL(pdf);
        }
        const link = document.createElement('a');
        link.href = printableUrl;
        if (download) {
            link.download = 'Vale-' + printableFolio.replaceAll(/[^a-z0-9_-]/gi, '-') + '.pdf';
        } else {
            link.target = '_blank';
            link.rel = 'noopener';
        }
        document.body.append(link);
        link.click();
        link.remove();
    } catch {
        message($('#print-error'), 'No se pudo preparar el PDF. Vuelve a generar el vale.', true);
    }
}

$('#print-close').addEventListener('click', () => $('#vale-print').close());
$('#print-now').addEventListener('click', () => openValePdf(false));
$('#download-vale').addEventListener('click', () => openValePdf(true));
$('#vale-print').addEventListener('close', () => {
    if (printableUrl) {
        const previous = printableUrl;
        // Give a new PDF tab time to load before releasing the URL.
        setTimeout(() => URL.revokeObjectURL(previous), 30_000);
        printableUrl = null;
    }
    printablePages = [];
    $('#print-content').replaceChildren();
});
