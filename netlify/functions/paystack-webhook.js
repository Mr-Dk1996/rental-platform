const crypto = require("crypto");

const jsonResponse = (statusCode, payload) => {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    };
};

const getEnv = () => {
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    const SUPABASE_URL = process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!PAYSTACK_SECRET_KEY) {
        throw new Error("PAYSTACK_SECRET_KEY is missing.");
    }

    if (!SUPABASE_URL) {
        throw new Error("SUPABASE_PROJECT_URL or SUPABASE_URL is missing.");
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
    }

    return {
        PAYSTACK_SECRET_KEY,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
    };
};

const getRawBody = (event) => {
    if (event.isBase64Encoded) {
        return Buffer.from(event.body || "", "base64").toString("utf8");
    }

    return event.body || "";
};

const safeCompare = (firstValue, secondValue) => {
    if (!firstValue || !secondValue) return false;

    const firstBuffer = Buffer.from(firstValue);
    const secondBuffer = Buffer.from(secondValue);

    if (firstBuffer.length !== secondBuffer.length) return false;

    return crypto.timingSafeEqual(firstBuffer, secondBuffer);
};

const getSupabaseHeaders = (serviceRoleKey) => {
    return {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
    };
};

const verifyPaystackTransaction = async (reference, paystackSecretKey) => {
    const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
                "Content-Type": "application/json"
            }
        }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
        throw new Error(result.message || "Paystack transaction verification failed.");
    }

    return result.data;
};

const findPaymentByReference = async (reference, supabaseUrl, serviceRoleKey) => {
    const response = await fetch(
        `${supabaseUrl}/rest/v1/payments?payment_reference=eq.${encodeURIComponent(reference)}&select=*`,
        {
            method: "GET",
            headers: getSupabaseHeaders(serviceRoleKey)
        }
    );

    const rows = await response.json();

    if (!response.ok) {
        throw new Error(rows.message || "Unable to fetch payment record.");
    }

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const updatePaymentAsPaid = async (reference, transaction, supabaseUrl, serviceRoleKey) => {
    const payload = {
        payment_status: "paid",
        payment_channel: transaction.channel || null,
        receipt_url: transaction.receipt_url || null,
        paid_at: transaction.paid_at || new Date().toISOString()
    };

    const response = await fetch(
        `${supabaseUrl}/rest/v1/payments?payment_reference=eq.${encodeURIComponent(reference)}&select=*`,
        {
            method: "PATCH",
            headers: {
                ...getSupabaseHeaders(serviceRoleKey),
                Prefer: "return=representation"
            },
            body: JSON.stringify(payload)
        }
    );

    const rows = await response.json();

    if (!response.ok) {
        throw new Error(rows.message || "Unable to update payment as paid.");
    }

    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const createLedgerBlock = async (paymentId, supabaseUrl, serviceRoleKey) => {
    const response = await fetch(
        `${supabaseUrl}/rest/v1/rpc/create_payment_ledger_block`,
        {
            method: "POST",
            headers: getSupabaseHeaders(serviceRoleKey),
            body: JSON.stringify({
                p_payment_id: paymentId
            })
        }
    );

    const resultText = await response.text();

    if (!response.ok) {
        throw new Error(resultText || "Ledger block creation failed.");
    }

    try {
        return JSON.parse(resultText);
    } catch {
        return resultText;
    }
};

const createLandlordNotification = async (payment, supabaseUrl, serviceRoleKey) => {
    if (!payment || !payment.landlord_id) return;

    try {
        const message = `A rent payment of GHS ${Number(payment.amount || 0).toLocaleString("en-GH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })} has been confirmed. Reference: ${payment.payment_reference}`;

        await fetch(`${supabaseUrl}/rest/v1/notifications`, {
            method: "POST",
            headers: getSupabaseHeaders(serviceRoleKey),
            body: JSON.stringify({
                user_id: payment.landlord_id,
                title: "Rent Payment Received",
                message,
                type: "success",
                related_id: payment.id,
                is_read: false
            })
        });
    } catch (error) {
        console.warn("Notification creation skipped:", error.message);
    }
};

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return jsonResponse(405, {
            success: false,
            message: "Method not allowed. Paystack webhooks must use POST."
        });
    }

    try {
        const {
            PAYSTACK_SECRET_KEY,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
        } = getEnv();

        const rawBody = getRawBody(event);
        const signature =
            event.headers["x-paystack-signature"] ||
            event.headers["X-Paystack-Signature"];

        const expectedSignature = crypto
            .createHmac("sha512", PAYSTACK_SECRET_KEY)
            .update(rawBody)
            .digest("hex");

        if (!safeCompare(expectedSignature, signature)) {
            return jsonResponse(401, {
                success: false,
                message: "Invalid Paystack webhook signature."
            });
        }

        let webhookEvent;

        try {
            webhookEvent = JSON.parse(rawBody);
        } catch {
            return jsonResponse(400, {
                success: false,
                message: "Invalid JSON payload."
            });
        }

        if (webhookEvent.event !== "charge.success") {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: `Webhook event ignored: ${webhookEvent.event || "unknown"}`
            });
        }

        const reference = webhookEvent.data?.reference;

        if (!reference) {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: "Webhook ignored because no transaction reference was provided."
            });
        }

        const existingPayment = await findPaymentByReference(
            reference,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
        );

        if (!existingPayment) {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: "Payment reference was verified by Paystack, but it does not belong to this system.",
                reference
            });
        }

        const transaction = await verifyPaystackTransaction(
            reference,
            PAYSTACK_SECRET_KEY
        );

        if (transaction.status !== "success") {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: `Transaction is not successful. Current status: ${transaction.status}`,
                reference
            });
        }

        const expectedAmountInPesewas = Math.round(Number(existingPayment.amount || 0) * 100);
        const receivedAmountInPesewas = Number(transaction.amount || 0);

        if (expectedAmountInPesewas !== receivedAmountInPesewas) {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: "Amount mismatch. Payment was not updated.",
                reference,
                expectedAmountInPesewas,
                receivedAmountInPesewas
            });
        }

        const expectedCurrency = String(existingPayment.currency || "GHS").toUpperCase();
        const receivedCurrency = String(transaction.currency || "GHS").toUpperCase();

        if (expectedCurrency !== receivedCurrency) {
            return jsonResponse(200, {
                success: true,
                ignored: true,
                message: "Currency mismatch. Payment was not updated.",
                reference,
                expectedCurrency,
                receivedCurrency
            });
        }

        const paidPayment = await updatePaymentAsPaid(
            reference,
            transaction,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
        );

        const finalPayment = paidPayment || existingPayment;

        const ledgerBlockId = await createLedgerBlock(
            finalPayment.id,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
        );

        await createLandlordNotification(
            finalPayment,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
        );

        return jsonResponse(200, {
            success: true,
            message: "Paystack webhook processed successfully.",
            reference,
            payment_id: finalPayment.id,
            ledger_block_id: ledgerBlockId
        });
    } catch (error) {
        console.error("Paystack webhook error:", error);

        return jsonResponse(500, {
            success: false,
            message: error.message || "Webhook processing failed."
        });
    }
};