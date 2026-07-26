(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.RentHavenReceipt = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const PAGE_WIDTH = 595;
    const PAGE_HEIGHT = 842;

    function valueOrFallback(value, fallback = 'Not available') {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function normaliseStatus(value) {
        const status = valueOrFallback(value, 'paid').toLowerCase();
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function normaliseEnvironment(value) {
        const environment = valueOrFallback(value, 'unknown').toLowerCase();
        return environment.charAt(0).toUpperCase() + environment.slice(1);
    }

    function formatAmount(value, currency = 'GHS') {
        const amount = Number(value || 0);
        const safeAmount = Number.isFinite(amount) ? amount : 0;

        return `${valueOrFallback(currency, 'GHS').toUpperCase()} ${safeAmount.toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    function formatDate(value) {
        if (!value) return 'Not available';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return valueOrFallback(value);
        }

        return date.toLocaleString('en-GH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function titleCase(value) {
        return valueOrFallback(value)
            .replace(/_/g, ' ')
            .replace(/\b\w/g, character => character.toUpperCase());
    }

    function buildPartySummary(name, email, phone) {
        const details = [name];

        if (email && email !== 'Not provided') details.push(email);
        if (phone && phone !== 'Not provided') details.push(phone);

        return details.join(' | ');
    }

    function prepareReceipt(receipt = {}) {
        const ledgerReference = valueOrFallback(
            receipt.ledger_reference || receipt.ledgerReference,
            'Ledger proof pending'
        );
        const currentHash = valueOrFallback(
            receipt.current_hash || receipt.currentHash,
            'Not available'
        );
        const hashAlgorithm = valueOrFallback(
            receipt.hash_algorithm || receipt.hashAlgorithm,
            'SHA-256'
        );
        const ledgerVersion = valueOrFallback(
            receipt.ledger_version || receipt.ledgerVersion,
            '2'
        );
        const hasLedgerProof =
            ledgerReference !== 'Ledger proof pending' &&
            currentHash !== 'Not available';
        const tenantName = valueOrFallback(
            receipt.tenant_name || receipt.tenantName,
            'Tenant'
        );
        const tenantEmail = valueOrFallback(
            receipt.tenant_email || receipt.tenantEmail,
            'Not provided'
        );
        const tenantPhone = valueOrFallback(
            receipt.tenant_phone || receipt.tenantPhone,
            'Not provided'
        );
        const landlordName = valueOrFallback(
            receipt.landlord_name || receipt.landlordName,
            'Landlord'
        );
        const landlordEmail = valueOrFallback(
            receipt.landlord_email || receipt.landlordEmail,
            'Not provided'
        );
        const landlordPhone = valueOrFallback(
            receipt.landlord_phone || receipt.landlordPhone,
            'Not provided'
        );

        return {
            amount: formatAmount(receipt.amount, receipt.currency),
            rawAmount: Number(receipt.amount || 0),
            currency: valueOrFallback(receipt.currency, 'GHS').toUpperCase(),
            status: normaliseStatus(receipt.payment_status || receipt.status),
            environment: normaliseEnvironment(
                receipt.payment_environment || receipt.environment
            ),
            paymentReference: valueOrFallback(
                receipt.payment_reference || receipt.paymentReference
            ),
            ledgerReference,
            blockNumber: valueOrFallback(
                receipt.block_number ?? receipt.blockNumber
            ),
            currentHash,
            hashAlgorithm,
            ledgerVersion,
            tenantName,
            tenantEmail,
            tenantPhone,
            tenantSummary: buildPartySummary(
                tenantName,
                tenantEmail,
                tenantPhone
            ),
            landlordName,
            landlordEmail,
            landlordPhone,
            landlordSummary: buildPartySummary(
                landlordName,
                landlordEmail,
                landlordPhone
            ),
            propertyTitle: valueOrFallback(
                receipt.property_title || receipt.propertyTitle,
                'Rental Property'
            ),
            propertyLocation: valueOrFallback(
                receipt.property_location || receipt.propertyLocation,
                'Location not specified'
            ),
            paymentChannel: titleCase(
                receipt.payment_channel || receipt.paymentChannel || 'Not recorded'
            ),
            paidAt: formatDate(
                receipt.paid_at || receipt.paidAt || receipt.created_at
            ),
            issuedAt: formatDate(new Date().toISOString()),
            hasLedgerProof,
            integrityStatus: hasLedgerProof
                ? 'Blockchain V2 proof recorded'
                : 'Payment verified; ledger proof pending'
        };
    }

    function ascii(value) {
        return String(value ?? '')
            .replace(/GH₵/g, 'GHS')
            .replace(/₵/g, 'C')
            .replace(/[–—]/g, '-')
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/·/g, '-')
            .normalize('NFKD')
            .replace(/[^\x20-\x7E]/g, '');
    }

    function escapePdfText(value) {
        return ascii(value)
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function safeFilePart(value) {
        return ascii(value)
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'payment';
    }

    function wrapText(value, maxCharacters) {
        const source = ascii(value);

        if (source.length <= maxCharacters) return [source];

        const words = source.split(/\s+/);
        const lines = [];
        let currentLine = '';

        words.forEach(word => {
            if (word.length > maxCharacters) {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = '';
                }

                for (let index = 0; index < word.length; index += maxCharacters) {
                    lines.push(word.slice(index, index + maxCharacters));
                }
                return;
            }

            const candidate = currentLine ? `${currentLine} ${word}` : word;

            if (candidate.length > maxCharacters) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = candidate;
            }
        });

        if (currentLine) lines.push(currentLine);
        return lines.length > 0 ? lines : [''];
    }

    function buildPdfContent(data) {
        const commands = [];

        function fillColor(red, green, blue) {
            commands.push(`${red} ${green} ${blue} rg`);
        }

        function strokeColor(red, green, blue) {
            commands.push(`${red} ${green} ${blue} RG`);
        }

        function rectangle(x, top, width, height, fill = true) {
            const y = PAGE_HEIGHT - top - height;
            commands.push(`${x} ${y} ${width} ${height} re ${fill ? 'f' : 'S'}`);
        }

        function line(x1, top1, x2, top2) {
            commands.push(
                `${x1} ${PAGE_HEIGHT - top1} m ${x2} ${PAGE_HEIGHT - top2} l S`
            );
        }

        function text(value, x, top, size = 10, bold = false, colour = [0.06, 0.09, 0.16]) {
            fillColor(...colour);
            commands.push(
                `BT /${bold ? 'F2' : 'F1'} ${size} Tf ` +
                `${x} ${PAGE_HEIGHT - top - size} Td ` +
                `(${escapePdfText(value)}) Tj ET`
            );
        }

        function wrappedText(value, x, top, maxCharacters, options = {}) {
            const {
                size = 9,
                bold = false,
                colour = [0.20, 0.25, 0.33],
                lineHeight = size + 4,
                maxLines = 3
            } = options;

            const lines = wrapText(value, maxCharacters).slice(0, maxLines);

            lines.forEach((item, index) => {
                text(item, x, top + (index * lineHeight), size, bold, colour);
            });

            return lines.length * lineHeight;
        }

        function labelledValue(label, value, x, top, width, options = {}) {
            text(label.toUpperCase(), x, top, 7.5, true, [0.39, 0.45, 0.55]);
            const consumed = wrappedText(value, x, top + 13, Math.max(20, Math.floor(width / 5.4)), {
                size: options.size || 9.5,
                bold: options.bold !== false,
                colour: options.colour || [0.06, 0.09, 0.16],
                lineHeight: 12,
                maxLines: options.maxLines || 2
            });
            return 13 + consumed;
        }

        fillColor(0.03, 0.48, 0.48);
        rectangle(0, 0, PAGE_WIDTH, 112);
        text('RENTHAVEN GHANA', 42, 30, 12, true, [1, 1, 1]);
        text('OFFICIAL RENT PAYMENT RECEIPT', 42, 51, 20, true, [1, 1, 1]);
        text(`Receipt: ${data.ledgerReference}`, 42, 82, 9, false, [0.87, 1, 0.98]);

        fillColor(0.93, 0.99, 0.98);
        rectangle(42, 134, 511, 76);
        text('AMOUNT PAID', 60, 151, 8, true, [0.05, 0.46, 0.38]);
        text(data.amount, 60, 170, 25, true, [0.02, 0.35, 0.31]);
        text(data.status.toUpperCase(), 445, 155, 10, true, [0.02, 0.45, 0.34]);
        text(data.environment.toUpperCase(), 445, 178, 8, true, [0.39, 0.45, 0.55]);

        text('RENTAL DETAILS', 42, 237, 11, true, [0.03, 0.48, 0.48]);
        strokeColor(0.84, 0.87, 0.91);
        line(42, 258, 553, 258);
        labelledValue('Property', data.propertyTitle, 42, 275, 235, {
            maxLines: 2
        });
        labelledValue('Location', data.propertyLocation, 318, 275, 235, {
            maxLines: 2
        });
        labelledValue('Tenant', data.tenantSummary, 42, 329, 235, {
            maxLines: 3
        });
        labelledValue('Landlord', data.landlordSummary, 318, 329, 235, {
            maxLines: 3
        });
        labelledValue('Payment date', data.paidAt, 42, 389, 235);
        labelledValue('Payment channel', data.paymentChannel, 318, 389, 235);

        text('PAYMENT IDENTIFIERS', 42, 450, 11, true, [0.03, 0.48, 0.48]);
        strokeColor(0.84, 0.87, 0.91);
        line(42, 471, 553, 471);
        labelledValue('Paystack / payment reference', data.paymentReference, 42, 486, 511, {
            size: 9.2,
            maxLines: 2
        });
        labelledValue('Blockchain ledger reference', data.ledgerReference, 42, 537, 511, {
            size: 9.2,
            maxLines: 2,
            colour: [0.02, 0.42, 0.34]
        });

        fillColor(0.97, 0.98, 0.99);
        rectangle(42, 594, 511, 150);
        text('BLOCKCHAIN V2 PROOF', 60, 611, 10, true, [0.03, 0.48, 0.48]);
        text(
            `Status: ${data.integrityStatus}`,
            60,
            633,
            9.5,
            true,
            data.hasLedgerProof ? [0.02, 0.45, 0.34] : [0.72, 0.39, 0.03]
        );
        text(
            `Block #${data.blockNumber}   Algorithm: ${data.hashAlgorithm}   Ledger version: V${data.ledgerVersion}`,
            60,
            655,
            8.5,
            false,
            [0.20, 0.25, 0.33]
        );
        text('Current hash', 60, 678, 7.5, true, [0.39, 0.45, 0.55]);
        wrappedText(data.currentHash, 60, 693, 74, {
            size: 7.4,
            colour: [0.12, 0.16, 0.23],
            lineHeight: 11,
            maxLines: 2
        });

        strokeColor(0.84, 0.87, 0.91);
        line(42, 768, 553, 768);
        text(
            'System-generated receipt. Confirm authenticity using the payment and ledger references.',
            42,
            783,
            7.5,
            false,
            [0.39, 0.45, 0.55]
        );
        text(`Issued: ${data.issuedAt}`, 42, 800, 7.5, false, [0.39, 0.45, 0.55]);

        return commands.join('\n');
    }

    function encodePdfString(value) {
        const output = new Uint8Array(value.length);

        for (let index = 0; index < value.length; index += 1) {
            output[index] = value.charCodeAt(index) & 0xff;
        }

        return output;
    }

    function buildPdfBytes(receipt) {
        const data = prepareReceipt(receipt);
        const content = buildPdfContent(data);
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            [
                '<< /Type /Page /Parent 2 0 R',
                `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
                '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >>',
                '/Contents 6 0 R >>'
            ].join(' '),
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
            `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
        ];

        let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
        const offsets = [0];

        objects.forEach((object, index) => {
            offsets.push(pdf.length);
            pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });

        const xrefOffset = pdf.length;
        pdf += `xref\n0 ${objects.length + 1}\n`;
        pdf += '0000000000 65535 f \n';

        offsets.slice(1).forEach(offset => {
            pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
        });

        pdf += [
            'trailer',
            `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
            'startxref',
            String(xrefOffset),
            '%%EOF'
        ].join('\n');

        return encodePdfString(pdf);
    }

    function createPdfBlob(receipt) {
        return new Blob([buildPdfBytes(receipt)], {
            type: 'application/pdf'
        });
    }

    function download(receipt) {
        if (typeof document === 'undefined' || typeof URL === 'undefined') {
            throw new Error('PDF download is only available in a web browser.');
        }

        const data = prepareReceipt(receipt);
        const blob = createPdfBlob(receipt);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const reference = data.ledgerReference !== 'Ledger proof pending'
            ? data.ledgerReference
            : data.paymentReference;

        link.href = url;
        link.download = `RentHaven-Receipt-${safeFilePart(reference)}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function buildPrintHtml(receipt) {
        const data = prepareReceipt(receipt);

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>RentHaven Receipt - ${escapeHtml(data.ledgerReference)}</title>
                <style>
                    * { box-sizing: border-box; }
                    body {
                        margin: 0;
                        padding: 28px;
                        background: #eef2f7;
                        color: #0f172a;
                        font-family: Arial, Helvetica, sans-serif;
                    }
                    .receipt {
                        width: min(100%, 760px);
                        margin: 0 auto;
                        background: #fff;
                        box-shadow: 0 18px 44px rgba(15, 23, 42, .13);
                    }
                    .header {
                        padding: 34px 38px;
                        color: #fff;
                        background: #087a7a;
                    }
                    .header p { margin: 0 0 8px; font-weight: 700; letter-spacing: .08em; }
                    .header h1 { margin: 0; font-size: 26px; }
                    .header small { display: block; margin-top: 13px; opacity: .9; }
                    .content { padding: 30px 38px 34px; }
                    .amount {
                        display: flex;
                        justify-content: space-between;
                        gap: 20px;
                        align-items: center;
                        padding: 20px;
                        background: #ecfdf5;
                        border: 1px solid #a7f3d0;
                    }
                    .label {
                        margin: 0 0 6px;
                        color: #64748b;
                        font-size: 11px;
                        font-weight: 800;
                        letter-spacing: .05em;
                        text-transform: uppercase;
                    }
                    .amount strong { color: #065f46; font-size: 27px; }
                    .status { color: #047857; font-weight: 800; text-align: right; }
                    h2 {
                        margin: 28px 0 14px;
                        padding-bottom: 9px;
                        border-bottom: 1px solid #dbe3ea;
                        color: #087a7a;
                        font-size: 15px;
                    }
                    .grid {
                        display: grid;
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 18px 26px;
                    }
                    .field strong { display: block; line-height: 1.45; word-break: break-word; }
                    .proof {
                        padding: 20px;
                        background: #f8fafc;
                        border: 1px solid #dbe3ea;
                    }
                    .proof-status {
                        margin-bottom: 12px;
                        color: ${data.hasLedgerProof ? '#047857' : '#b45309'};
                        font-weight: 800;
                    }
                    code {
                        display: block;
                        margin-top: 6px;
                        color: #334155;
                        font-size: 11px;
                        line-height: 1.5;
                        overflow-wrap: anywhere;
                    }
                    footer {
                        margin-top: 30px;
                        padding-top: 15px;
                        border-top: 1px solid #dbe3ea;
                        color: #64748b;
                        font-size: 11px;
                        line-height: 1.5;
                    }
                    @media print {
                        @page { size: A4; margin: 12mm; }
                        body { padding: 0; background: #fff; }
                        .receipt { width: 100%; box-shadow: none; }
                    }
                    @media (max-width: 600px) {
                        body { padding: 0; }
                        .content, .header { padding-left: 22px; padding-right: 22px; }
                        .grid { grid-template-columns: 1fr; }
                    }
                </style>
            </head>
            <body>
                <main class="receipt">
                    <header class="header">
                        <p>RENTHAVEN GHANA</p>
                        <h1>Official Rent Payment Receipt</h1>
                        <small>Receipt: ${escapeHtml(data.ledgerReference)}</small>
                    </header>
                    <section class="content">
                        <div class="amount">
                            <div>
                                <p class="label">Amount paid</p>
                                <strong>${escapeHtml(data.amount)}</strong>
                            </div>
                            <div class="status">
                                ${escapeHtml(data.status)}<br>
                                <small>${escapeHtml(data.environment)} environment</small>
                            </div>
                        </div>

                        <h2>Rental details</h2>
                        <div class="grid">
                            <div class="field"><p class="label">Property</p><strong>${escapeHtml(data.propertyTitle)}</strong></div>
                            <div class="field"><p class="label">Location</p><strong>${escapeHtml(data.propertyLocation)}</strong></div>
                            <div class="field">
                                <p class="label">Tenant</p>
                                <strong>${escapeHtml(data.tenantName)}</strong>
                                <small>${escapeHtml(data.tenantEmail)} · ${escapeHtml(data.tenantPhone)}</small>
                            </div>
                            <div class="field">
                                <p class="label">Landlord</p>
                                <strong>${escapeHtml(data.landlordName)}</strong>
                                <small>${escapeHtml(data.landlordEmail)} · ${escapeHtml(data.landlordPhone)}</small>
                            </div>
                            <div class="field"><p class="label">Payment date</p><strong>${escapeHtml(data.paidAt)}</strong></div>
                            <div class="field"><p class="label">Channel</p><strong>${escapeHtml(data.paymentChannel)}</strong></div>
                        </div>

                        <h2>Payment identifiers</h2>
                        <div class="grid">
                            <div class="field"><p class="label">Payment reference</p><strong>${escapeHtml(data.paymentReference)}</strong></div>
                            <div class="field"><p class="label">Ledger reference</p><strong>${escapeHtml(data.ledgerReference)}</strong></div>
                        </div>

                        <h2>Blockchain V2 proof</h2>
                        <div class="proof">
                            <div class="proof-status">${escapeHtml(data.integrityStatus)}</div>
                            <div>Block #${escapeHtml(data.blockNumber)} · ${escapeHtml(data.hashAlgorithm)} · V${escapeHtml(data.ledgerVersion)}</div>
                            <p class="label" style="margin-top: 14px;">Current hash</p>
                            <code>${escapeHtml(data.currentHash)}</code>
                        </div>

                        <footer>
                            This system-generated receipt confirms a RentHaven payment record.
                            Confirm its authenticity using the payment and ledger references.<br>
                            Issued: ${escapeHtml(data.issuedAt)}
                        </footer>
                    </section>
                </main>
            </body>
            </html>`;
    }

    function print(receipt) {
        if (typeof window === 'undefined') {
            throw new Error('Receipt printing is only available in a web browser.');
        }

        const printWindow = window.open('', '_blank', 'width=900,height=760');

        if (!printWindow) {
            throw new Error('The receipt window was blocked. Allow pop-ups and try again.');
        }

        printWindow.document.open();
        printWindow.document.write(buildPrintHtml(receipt));
        printWindow.document.close();

        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    }

    return {
        prepareReceipt,
        buildPdfBytes,
        createPdfBlob,
        download,
        print
    };
});
