const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL =
    process.env.SUPABASE_PROJECT_URL ||
    process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: JSON.stringify(body)
    };
}

function getSupabaseHeaders(prefer) {
    const headers = {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    };

    if (prefer) {
        headers.Prefer = prefer;
    }

    return headers;
}

async function readJson(response) {
    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function getAuthorizationHeader(event) {
    return (
        event.headers?.authorization ||
        event.headers?.Authorization ||
        ''
    );
}

async function getAuthenticatedRequester(event) {
    const authorization = getAuthorizationHeader(event);

    if (!authorization.toLowerCase().startsWith('bearer ')) {
        return null;
    }

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            method: 'GET',
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: authorization
            }
        });

        if (!response.ok) return null;

        const user = await readJson(response);
        return user?.id ? user : null;
    } catch {
        return null;
    }
}

async function getSupabaseRows(path) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${path}`,
        {
            method: 'GET',
            headers: getSupabaseHeaders()
        }
    );

    const rows = await readJson(response);

    if (!response.ok) {
        throw new Error(
            rows?.message ||
            rows?.details ||
            'Unable to retrieve receipt details.'
        );
    }

    return Array.isArray(rows) ? rows : [];
}

async function requesterCanReadReceipt(requester, payment) {
    if (!requester?.id || !payment) return false;

    if (
        requester.id === payment.tenant_id ||
        requester.id === payment.landlord_id
    ) {
        return true;
    }

    const rows = await getSupabaseRows(
        `users?id=eq.${encodeURIComponent(requester.id)}` +
        '&select=role&limit=1'
    );

    return String(rows[0]?.role || '').toLowerCase() === 'admin';
}

async function getSecureReceiptData(requester, payment, ledgerProof) {
    if (!(await requesterCanReadReceipt(requester, payment))) {
        return null;
    }

    const userIds = [
        payment.tenant_id,
        payment.landlord_id
    ].filter(Boolean);

    const [userRows, propertyRows] = await Promise.all([
        userIds.length > 0
            ? getSupabaseRows(
                `users?id=in.(${userIds.map(encodeURIComponent).join(',')})` +
                '&select=id,full_name,email,phone,phone_number'
            )
            : Promise.resolve([]),
        payment.property_id
            ? getSupabaseRows(
                `properties?id=eq.${encodeURIComponent(payment.property_id)}` +
                '&select=id,title,location&limit=1'
            )
            : Promise.resolve([])
    ]);

    const userMap = userRows.reduce((map, user) => {
        map[user.id] = user;
        return map;
    }, {});
    const tenant = userMap[payment.tenant_id] || {};
    const landlord = userMap[payment.landlord_id] || {};
    const property = propertyRows[0] || {};

    return {
        amount: payment.amount,
        currency: payment.currency || 'GHS',
        payment_status: payment.payment_status,
        payment_environment: payment.payment_environment,
        payment_reference: payment.payment_reference,
        payment_channel: payment.payment_channel,
        paid_at: payment.paid_at || payment.created_at,
        property_title: property.title || 'Rental Property',
        property_location: property.location || 'Location not specified',
        tenant_name: tenant.full_name || 'Tenant',
        tenant_email: tenant.email || 'Not provided',
        tenant_phone:
            tenant.phone ||
            tenant.phone_number ||
            'Not provided',
        landlord_name: landlord.full_name || 'Landlord',
        landlord_email: landlord.email || 'Not provided',
        landlord_phone:
            landlord.phone ||
            landlord.phone_number ||
            'Not provided',
        ledger_reference: ledgerProof?.ledger_reference,
        block_number: ledgerProof?.block_number,
        current_hash: ledgerProof?.current_hash,
        hash_algorithm: ledgerProof?.hash_algorithm,
        ledger_version: ledgerProof?.ledger_version
    };
}

function getSafePaymentResponse(payment) {
    if (!payment) return null;

    return {
        amount: payment.amount,
        currency: payment.currency || 'GHS',
        payment_status: payment.payment_status,
        payment_environment: payment.payment_environment,
        payment_reference: payment.payment_reference,
        payment_channel: payment.payment_channel,
        paid_at: payment.paid_at || payment.created_at,
        description: payment.description
    };
}

function getPaystackEnvironment(transaction) {
    const transactionDomain = String(transaction?.domain || '').toLowerCase();

    if (transactionDomain === 'live' || transactionDomain === 'test') {
        return transactionDomain;
    }

    const key = String(PAYSTACK_SECRET_KEY || '').toLowerCase();

    if (key.startsWith('sk_live_')) return 'live';
    if (key.startsWith('sk_test_')) return 'test';

    return 'unknown';
}

async function findPaymentByReference(reference) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/payments` +
        `?payment_reference=eq.${encodeURIComponent(reference)}` +
        '&select=*' +
        '&limit=1',
        {
            method: 'GET',
            headers: getSupabaseHeaders()
        }
    );

    const rows = await readJson(response);

    if (!response.ok) {
        throw new Error(rows?.message || 'Unable to retrieve the RentHaven payment record.');
    }

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function verifyWithPaystack(reference) {
    const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
            }
        }
    );

    const result = await readJson(response);

    if (!response.ok || !result?.status) {
        throw new Error(result?.message || 'Paystack could not verify this transaction.');
    }

    return result.data;
}

function validateVerifiedTransaction(payment, transaction, reference) {
    if (!transaction || transaction.status !== 'success') {
        throw new Error(`Payment is not successful. Current status: ${transaction?.status || 'unknown'}.`);
    }

    if (String(transaction.reference || '') !== String(reference)) {
        throw new Error('Paystack returned a different payment reference.');
    }

    const expectedAmountInPesewas = Math.round(Number(payment.amount || 0) * 100);
    const receivedAmountInPesewas = Number(transaction.amount || 0);

    if (
        !Number.isFinite(expectedAmountInPesewas) ||
        expectedAmountInPesewas <= 0 ||
        expectedAmountInPesewas !== receivedAmountInPesewas
    ) {
        throw new Error('Verified Paystack amount does not match the RentHaven payment record.');
    }

    const expectedCurrency = String(payment.currency || 'GHS').toUpperCase();
    const receivedCurrency = String(transaction.currency || '').toUpperCase();

    if (expectedCurrency !== receivedCurrency) {
        throw new Error('Verified Paystack currency does not match the RentHaven payment record.');
    }
}

async function updatePaymentAsPaid(reference, transaction) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/payments` +
        `?payment_reference=eq.${encodeURIComponent(reference)}` +
        '&select=*',
        {
            method: 'PATCH',
            headers: getSupabaseHeaders('return=representation'),
            body: JSON.stringify({
                payment_status: 'paid',
                payment_environment: getPaystackEnvironment(transaction),
                payment_channel: transaction.channel || null,
                receipt_url: transaction.receipt_url || null,
                paid_at: new Date(
                    transaction.paid_at ||
                    transaction.created_at ||
                    Date.now()
                ).toISOString()
            })
        }
    );

    const rows = await readJson(response);

    if (!response.ok || !Array.isArray(rows) || rows.length === 0) {
        throw new Error(rows?.message || 'Unable to update the verified payment record.');
    }

    return rows[0];
}

async function createLedgerBlock(paymentId) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/create_payment_ledger_block`,
        {
            method: 'POST',
            headers: getSupabaseHeaders(),
            body: JSON.stringify({
                p_payment_id: paymentId
            })
        }
    );

    const result = await readJson(response);

    if (!response.ok) {
        const message =
            result?.message ||
            result?.details ||
            'Blockchain-style ledger block creation failed.';

        const error = new Error(message);
        error.ledgerDetails = result;
        throw error;
    }

    return result;
}

async function getLedgerProof(paymentId) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/payment_ledger` +
        `?payment_id=eq.${encodeURIComponent(paymentId)}` +
        '&select=id,block_number,payment_reference,ledger_reference,' +
        'previous_hash,current_hash,hash_algorithm,ledger_version,created_at' +
        '&limit=1',
        {
            method: 'GET',
            headers: getSupabaseHeaders()
        }
    );

    const rows = await readJson(response);

    if (!response.ok) {
        throw new Error(rows?.message || 'Ledger block was created, but its proof could not be retrieved.');
    }

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(200, { message: 'OK' });
    }

    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return jsonResponse(405, { error: 'Method not allowed.' });
    }

    try {
        if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return jsonResponse(500, {
                error: 'Payment verification server is not fully configured.'
            });
        }

        let body = {};

        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            body = {};
        }

        const reference =
            event.queryStringParameters?.reference ||
            body.reference;

        if (!reference) {
            return jsonResponse(400, {
                error: 'Payment reference is required.'
            });
        }

        const payment = await findPaymentByReference(reference);

        if (!payment) {
            return jsonResponse(404, {
                error: 'This payment reference does not belong to RentHaven Ghana.'
            });
        }

        const transaction = await verifyWithPaystack(reference);
        validateVerifiedTransaction(payment, transaction, reference);

        const paidPayment = await updatePaymentAsPaid(reference, transaction);

        let ledgerBlockId;

        try {
            ledgerBlockId = await createLedgerBlock(paidPayment.id);
        } catch (ledgerError) {
            return jsonResponse(500, {
                error: 'Payment was verified, but the blockchain-style ledger proof could not be created.',
                payment: getSafePaymentResponse(paidPayment),
                ledger_error: ledgerError.ledgerDetails || ledgerError.message
            });
        }

        const ledgerProof = await getLedgerProof(paidPayment.id);

        if (!ledgerProof?.ledger_reference) {
            return jsonResponse(500, {
                error: 'Payment was verified, but the Blockchain V2 ledger reference is missing.',
                payment: getSafePaymentResponse(paidPayment),
                ledger_block_id: ledgerBlockId
            });
        }

        const requester = await getAuthenticatedRequester(event);
        let receiptData = null;

        try {
            receiptData = await getSecureReceiptData(
                requester,
                paidPayment,
                ledgerProof
            );
        } catch (receiptError) {
            console.warn(
                'Secure receipt details could not be loaded:',
                receiptError.message
            );
        }

        return jsonResponse(200, {
            message: 'Payment verified and Blockchain V2 ledger proof created successfully.',
            status: 'paid',
            payment: getSafePaymentResponse(paidPayment),
            ledger_block_id: ledgerBlockId,
            ledger_reference: ledgerProof.ledger_reference,
            ledger_proof: ledgerProof,
            receipt_data: receiptData
        });
    } catch (error) {
        return jsonResponse(400, {
            error: 'Payment verification failed.',
            details: error.message
        });
    }
};
