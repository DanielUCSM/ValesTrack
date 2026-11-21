'use strict';

// A4 in PDF points. The canvas renders at 216 dpi; all coordinates use points.
const valePaper = { width: 595.28, height: 841.89, margin: 26, scale: 3 };
const valeColumns = [
    ['N.º', 23], ['Código', 55], ['Material / producto', 157], ['Unidad', 43],
    ['Solicitada', 54], ['Autorizada', 54], ['Entregada', 54], ['Observaciones', 103.28],
];

function loadValeImage(source) {
    return new Promise(resolve => {
        if (!source) return resolve(null);
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = source;
    });
}

function valeDate(date) {
    return date ? date.slice(0, 10).split('-').reverse().join('/') : '';
}

function valeSignature(value) {
    return typeof value === 'string' && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)
        ? value : null;
}

function createValePage() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(valePaper.width * valePaper.scale);
    canvas.height = Math.round(valePaper.height * valePaper.scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(canvas.width / valePaper.width, canvas.height / valePaper.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, valePaper.width, valePaper.height);
    ctx.textBaseline = 'middle';
    return { canvas, ctx };
}

function valeFont(ctx, size, bold = false) {
    ctx.font = `${bold ? 700 : 400} ${size}px Arial, sans-serif`;
}

function valeText(ctx, text, x, y, size, { align = 'left', bold = false, color = '#151b23' } = {}) {
    valeFont(ctx, size, bold);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(String(text), x, y);
}

function wrapValeText(ctx, value, width, size, bold = false) {
    const lines = [];
    valeFont(ctx, size, bold);
    for (const paragraph of String(value ?? '').split(/\r?\n/)) {
        let line = '';
        for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
            const next = line ? line + ' ' + word : word;
            if (ctx.measureText(next).width <= width) {
                line = next;
                continue;
            }
            if (line) lines.push(line);
            line = '';
            for (const character of word) {
                if (line && ctx.measureText(line + character).width > width) {
                    lines.push(line);
                    line = '';
                }
                line += character;
            }
        }
        lines.push(line);
    }
    return lines;
}

function valeLine(ctx, x1, y1, x2, y2, color = '#46515e', width = .55) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

const valeColor = {
    ink: '#163b32', subtle: '#53645e', divider: '#c4d6ce',
    surface: '#eef5f1', alternate: '#f5f8f6', accent: '#dd7739',
};

function valeFill(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
}

function drawValeImage(ctx, image, x, y, width, height) {
    if (!image) return;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function valeFields(ctx, top, fields) {
    const { margin, width } = valePaper;
    const gap = 16;
    const cellWidth = (width - 2 * margin - (fields.length - 1) * gap) / fields.length;
    const contents = fields.map(([, value]) => wrapValeText(ctx, value || '—', cellWidth - 3, 9.5));
    const height = Math.max(32, ...contents.map(lines => 22 + lines.length * 11));
    fields.forEach(([label], index) => {
        const left = margin + index * (cellWidth + gap);
        valeText(ctx, label, left, top + 7, 7.4, { bold: true, color: valeColor.subtle });
        contents[index].forEach((line, row) =>
            valeText(ctx, line, left, top + 20 + row * 11, 9.5, { color: valeColor.ink }));
        valeLine(ctx, left, top + height, left + cellWidth, top + height, valeColor.divider, .45);
    });
    return top + height + 7;
}

function valeHeader(ctx, data, logo) {
    const { width, margin } = valePaper;
    drawValeImage(ctx, logo, margin - 8, 27, 77, 56);
    valeText(ctx, 'Vale de salida', margin + 78, 45, 24, { bold: true, color: valeColor.ink });
    valeText(ctx, 'de almacén', margin + 78, 68, 17, { color: valeColor.ink });
    const folioLeft = width - margin - 162;
    valeFill(ctx, folioLeft, 28, 162, 54, valeColor.surface);
    valeText(ctx, 'FOLIO', folioLeft + 10, 43, 7.5, { bold: true, color: valeColor.subtle });
    wrapValeText(ctx, data.folio_n, 142, 11, true).forEach((line, i) =>
        valeText(ctx, line, folioLeft + 10, 59 + i * 11, 11, { bold: true, color: valeColor.ink }));
    valeFill(ctx, margin, 94, width - 2 * margin, 2, valeColor.divider);
    valeFill(ctx, margin, 94, 54, 2, valeColor.accent);
    const status = data.anulado_en ? 'Anulado' : data.entrega_iso ? 'Entregado' : 'Pendiente';
    let y = valeFields(ctx, 109, [
        ['EMISIÓN', valeDate(data.emision_iso)], ['ENTREGA', valeDate(data.entrega_iso) || 'Por registrar'],
        ['ESTADO', status],
    ]);
    y = valeFields(ctx, y, [
        ['PROYECTO / OBRA', data.rotulos.proyecto], ['ÁREA SOLICITANTE', data.rotulos.area], ['SOLICITANTE', data.rotulos.solicitante],
    ]);
    y = valeFields(ctx, y, [['TIPO DE SALIDA', data.tipo_salida], ['MOTIVO DE SALIDA', data.motivo]]);
    if (data.anulado_en) y = valeFields(ctx, y, [['MOTIVO DE ANULACIÓN', data.motivo_anulacion]]);
    return y + 4;
}

function valeGridRow(ctx, y, cells, { header = false, striped = false } = {}) {
    const { margin, width } = valePaper;
    const size = header ? 7.6 : 8.4;
    const lines = cells.map((value, i) => wrapValeText(ctx, value, valeColumns[i][1] - 8, size, header));
    const height = Math.max(header ? 23 : 20, ...lines.map(cell => cell.length * 10.5 + 8));
    return {
        height,
        draw() {
            if (header || striped) valeFill(ctx, margin, y, width - 2 * margin, height,
                header ? valeColor.surface : valeColor.alternate);
            let x = margin;
            lines.forEach((cell, col) => {
                const columnWidth = valeColumns[col][1];
                const center = [0, 3, 4, 5, 6].includes(col);
                const offset = (height - (cell.length - 1) * 10.5) / 2;
                cell.forEach((line, row) => valeText(ctx, line, x + (center ? columnWidth / 2 : 4),
                    y + offset + row * 10.5, size, {
                        bold: header, align: center ? 'center' : 'left', color: valeColor.ink,
                    }));
                x += columnWidth;
            });
            valeLine(ctx, margin, y + height, width - margin, y + height, valeColor.divider);
        },
    };
}

function valeSigners(ctx, data) {
    const names = [
        ['Solicitante', data.rotulos.solicitante],
        ['Responsable de almacén', data.rotulos.despacho],
        ['Autorizado', data.rotulos.autorizador],
    ];
    const width = (valePaper.width - 2 * valePaper.margin) / names.length;
    return names.map(([role, person]) => ({ role, lines: wrapValeText(ctx, person || 'Nombre y firma', width - 28, 8.4) }));
}

function valeEnd(ctx, top, signers, signatures) {
    const { margin, width } = valePaper;
    const column = (width - 2 * margin) / signers.length;
    const baseline = top + 76;
    valeText(ctx, 'Firmas', margin, top + 23, 12, { bold: true, color: valeColor.ink });
    signers.forEach(({ role, lines }, index) => {
        const left = margin + index * column;
        const center = left + column / 2;
        drawValeImage(ctx, signatures[index], left + 20, baseline - 42, column - 40, 40);
        valeLine(ctx, left + 14, baseline, left + column - 14, baseline, valeColor.subtle, .55);
        valeText(ctx, role, center, baseline + 11, 8.4, { bold: true, color: valeColor.ink, align: 'center' });
        lines.forEach((line, row) => valeText(ctx, line, center, baseline + 23 + row * 11, 8.4, {
            color: valeColor.subtle, align: 'center',
        }));
    });
}

async function makeValeDocument(data) {
    const [logo, ...signatures] = await Promise.all([
        loadValeImage('/logo-vale.png'),
        ...[data.firma_solicita, data.firma_despacha, data.firma_autoriza].map(value => loadValeImage(valeSignature(value))),
    ]);
    const rows = data.items.filter(item => item.activo).map(item => [
        item.n_item, item.codigo_producto, item.descripcion_material, item.unidad,
        item.cantidad_solicitada, item.cantidad_autorizada, item.cantidad_entregada, item.observaciones,
    ]);
    if (rows.length === 0) rows.push(['—', '', 'Sin materiales activos', '', '', '', '', '']);
    const pages = [];
    let canvas;
    let ctx;
    let y;
    const limit = valePaper.height - valePaper.margin;
    function finishPage() {
        if (!canvas) return;
        pages.push({ source: canvas.toDataURL('image/jpeg', .96), width: canvas.width, height: canvas.height });
        canvas.width = 1;
        canvas.height = 1;
    }
    function nextPage(withGrid = true) {
        finishPage();
        ({ canvas, ctx } = createValePage());
        y = valeHeader(ctx, data, logo);
        if (withGrid) {
            valeText(ctx, 'Materiales del vale', valePaper.margin, y + 9, 13, { bold: true, color: valeColor.ink });
            y += 22;
            const header = valeGridRow(ctx, y, valeColumns.map(([label]) => label), { header: true });
            header.draw();
            y += header.height;
        }
    }

    nextPage();
    for (const [index, cells] of rows.entries()) {
        const style = { striped: index % 2 === 1 };
        let row = valeGridRow(ctx, y, cells, style);
        if (y + row.height > limit) {
            nextPage();
            row = valeGridRow(ctx, y, cells, style);
        }
        row.draw();
        y += row.height;
    }
    const signers = valeSigners(ctx, data);
    if (y + 100 + Math.max(...signers.map(signer => signer.lines.length)) * 11 > limit) nextPage(false);
    valeEnd(ctx, y, signers, signatures);
    finishPage();
    return pages;
}

// The PDF contains only the rendered pages, independently of browser print settings.
function valePdfBytes(pages) {
    const text = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let size = 0;
    function add(content) {
        const bytes = typeof content === 'string' ? text.encode(content) : content;
        chunks.push(bytes);
        size += bytes.length;
    }
    function object(id, ...body) {
        offsets[id] = size;
        add(id + ' 0 obj\n');
        body.forEach(add);
        add('\nendobj\n');
    }
    add('%PDF-1.4\n');
    add(new Uint8Array([37, 226, 227, 207, 211, 10]));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' +
        pages.map((_, i) => (3 + 3 * i) + ' 0 R').join(' ') + '] >>');
    pages.forEach((page, index) => {
        const number = 3 + index * 3;
        const { width, height } = valePaper;
        const raw = atob(page.source.split(',')[1]);
        const jpeg = Uint8Array.from(raw, character => character.charCodeAt(0));
        const instructions = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
        object(number, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]
/Resources << /XObject << /Im0 ${number + 1} 0 R >> >> /Contents ${number + 2} 0 R >>`);
        object(number + 1, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}
/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
        object(number + 2, `<< /Length ${text.encode(instructions).length} >>\nstream\n`, instructions, 'endstream');
    });
    const xref = size;
    add('xref\n0 ' + offsets.length + '\n0000000000 65535 f \n');
    for (const offset of offsets.slice(1)) add(String(offset).padStart(10, '0') + ' 00000 n \n');
    add('trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return chunks;
}
