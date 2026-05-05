import FormData from "form-data";
import Mailgun from "mailgun.js";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const mailgun = new Mailgun(FormData);

function getClient() {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!apiKey || !domain) return null;
  return { client: mailgun.client({ username: "api", key: apiKey }), domain };
}

export async function sendAdminOtpEmail(to: string, otp: string, purpose: "login" | "create" | "reset"): Promise<boolean> {
  const mg = getClient();
  if (!mg) { console.warn("Mailgun not configured"); return false; }
  const subjectMap = {
    login: "Admin Login OTP — Pearlis",
    create: "Admin Account Creation OTP — Pearlis",
    reset: "Admin Password Reset OTP — Pearlis",
  };
  const purposeText = {
    login: "login to the admin panel",
    create: "create a new admin account",
    reset: "reset your admin password",
  };
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Admin <noreply@${mg.domain}>`,
      to: [to],
      subject: subjectMap[purpose],
      html: `
        <div style="font-family:'Georgia',serif;max-width:480px;margin:0 auto;background:#0F0F0F;padding:0;border:1px solid #222;">
          <div style="background:#0F0F0F;padding:32px 40px;border-bottom:2px solid #D4AF37;text-align:center;">
            <h1 style="font-size:22px;letter-spacing:10px;color:#fff;margin:0;">PEARLIS</h1>
            <p style="color:#D4AF37;font-size:9px;letter-spacing:5px;text-transform:uppercase;margin:4px 0 0;">Admin Portal</p>
          </div>
          <div style="background:#1A1A1A;padding:40px;">
            <p style="color:#999;font-size:13px;line-height:1.7;margin-bottom:28px;">
              Your one-time password to <strong style="color:#D4AF37;">${purposeText[purpose]}</strong>. This code expires in <strong>5 minutes</strong>.
            </p>
            <div style="background:#0F0F0F;border:1px solid #D4AF37;padding:24px;text-align:center;margin-bottom:28px;">
              <span style="font-size:40px;letter-spacing:14px;color:#D4AF37;font-family:monospace;font-weight:bold;">${otp}</span>
            </div>
            <p style="color:#555;font-size:11px;line-height:1.6;margin:0;">
              If you did not request this code, someone may be attempting to access your admin panel. Do not share this code with anyone.
            </p>
          </div>
          <div style="background:#0F0F0F;padding:16px 40px;text-align:center;border-top:1px solid #222;">
            <p style="color:#444;font-size:10px;letter-spacing:2px;margin:0;">© PEARLIS FINE JEWELLERY — ADMIN</p>
          </div>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("Mailgun sendAdminOtpEmail error:", err);
    return false;
  }
}

export async function sendOtpEmail(to: string, otp: string, name: string): Promise<boolean> {
  const mg = getClient();
  if (!mg) { console.warn("Mailgun not configured"); return false; }
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis <noreply@${mg.domain}>`,
      to: [to],
      subject: "Your Pearlis Verification Code",
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 520px; margin: 0 auto; background: #FAF7F2; padding: 48px 40px;">
          <h1 style="font-size: 28px; letter-spacing: 8px; color: #0F0F0F; margin-bottom: 8px;">PEARLIS</h1>
          <p style="color: #888; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 40px;">Fine Jewellery</p>
          <h2 style="font-size: 20px; color: #0F0F0F; margin-bottom: 16px;">Hello, ${name}</h2>
          <p style="color: #555; font-size: 14px; line-height: 1.8; margin-bottom: 32px;">
            Please use the following One-Time Password to verify your email address. This code expires in <strong>10 minutes</strong>.
          </p>
          <div style="background: #0F0F0F; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 36px; letter-spacing: 12px; color: #D4AF37; font-family: monospace; font-weight: bold;">${otp}</span>
          </div>
          <p style="color: #999; font-size: 12px; line-height: 1.6;">
            If you did not request this code, please ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E0D8; margin: 32px 0;" />
          <p style="color: #bbb; font-size: 11px; letter-spacing: 2px; text-align: center;">© PEARLIS FINE JEWELLERY</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("Mailgun sendOtpEmail error:", err);
    return false;
  }
}

/* ── Order confirmation ── */
interface OrderEmailData {
  id: number;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  items: { productName: string; quantity: number; price: number }[];
  subtotal: number;
  discount: number;
  couponCode?: string | null;
  total: number;
  paymentMethod: string;
  shippingAddress?: {
    name: string; phone?: string; line1: string; line2?: string;
    city: string; state: string; postalCode: string; country?: string;
  } | null;
}

const INR = (usd: number) => "₹" + Math.round(usd * 83).toLocaleString("en-IN");

function orderItemsTable(items: OrderEmailData["items"]): string {
  const rows = items.map(item => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #ece8e1;font-size:14px;color:#0F0F0F;">${item.productName}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #ece8e1;font-size:14px;color:#555;text-align:center;">${item.quantity}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #ece8e1;font-size:14px;color:#555;text-align:right;">${INR(item.price)}</td>
      <td style="padding:12px 16px;border-bottom:1px solid #ece8e1;font-size:14px;font-weight:600;color:#0F0F0F;text-align:right;">${INR(item.price * item.quantity)}</td>
    </tr>`).join("");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #ece8e1;">
      <thead>
        <tr style="background:#FAF8F3;">
          <th style="padding:10px 16px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:600;text-align:left;">Item</th>
          <th style="padding:10px 16px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:600;text-align:center;">Qty</th>
          <th style="padding:10px 16px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:600;text-align:right;">Price</th>
          <th style="padding:10px 16px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#888;font-weight:600;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function orderConfirmationHtml(order: OrderEmailData, appUrl: string): string {
  const invoiceNo = order.id.toString().padStart(6, "0");
  const subtotalINR = Math.round(order.subtotal * 83);
  const discountINR = Math.round(order.discount * 83);
  const shippingINR = subtotalINR >= 5000 ? 0 : 99;
  const totalINR = subtotalINR - discountINR + shippingINR;
  const addr = order.shippingAddress;
  const payLabel = order.paymentMethod === "cod" ? "Cash on Delivery" :
                   order.paymentMethod === "razorpay" ? "Razorpay (Online)" :
                   order.paymentMethod || "Online";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F1EB;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EB;padding:40px 16px;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E8E2D9;">

  <!-- Header -->
  <tr>
    <td style="background:#0F0F0F;padding:36px 40px;text-align:center;">
      <div style="font-size:30px;letter-spacing:10px;color:#fff;font-weight:700;margin-bottom:4px;">PEARLIS</div>
      <div style="font-size:10px;letter-spacing:5px;color:#D4AF37;text-transform:uppercase;">Fine Jewellery</div>
    </td>
  </tr>

  <!-- Gold bar -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>

  <!-- Confirmation banner -->
  <tr>
    <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #ECE8E1;">
      <div style="width:56px;height:56px;background:#D4AF37;border-radius:50%;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;">
        <span style="color:#fff;font-size:28px;line-height:56px;display:block;">✓</span>
      </div>
      <h2 style="font-size:22px;color:#0F0F0F;margin:0 0 8px;font-weight:400;letter-spacing:1px;">Order Confirmed!</h2>
      <p style="color:#888;font-size:13px;margin:0;letter-spacing:0.5px;">Thank you, <strong style="color:#0F0F0F;">${order.customerName}</strong>. Your order has been received.</p>
    </td>
  </tr>

  <!-- Order meta -->
  <tr>
    <td style="padding:24px 40px;background:#FAF8F3;border-bottom:1px solid #ECE8E1;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="text-align:center;padding:0 12px;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:5px;">Order No.</div>
            <div style="font-size:16px;font-weight:700;color:#0F0F0F;">#ORD-${invoiceNo}</div>
          </td>
          <td style="text-align:center;padding:0 12px;border-left:1px solid #ECE8E1;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:5px;">Date</div>
            <div style="font-size:14px;color:#0F0F0F;">${fmtDate(order.createdAt)}</div>
          </td>
          <td style="text-align:center;padding:0 12px;border-left:1px solid #ECE8E1;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:5px;">Payment</div>
            <div style="font-size:13px;color:#0F0F0F;">${payLabel}</div>
          </td>
          <td style="text-align:center;padding:0 12px;border-left:1px solid #ECE8E1;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:5px;">Status</div>
            <div style="font-size:13px;font-weight:600;color:#ca8a04;text-transform:uppercase;letter-spacing:1px;">Confirmed</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Items -->
  <tr>
    <td style="padding:32px 40px 20px;">
      <h3 style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#888;margin:0 0 16px;">Your Items</h3>
      ${orderItemsTable(order.items)}
    </td>
  </tr>

  <!-- Price summary -->
  <tr>
    <td style="padding:0 40px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:280px;margin-left:auto;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#666;">Subtotal</td>
          <td style="padding:6px 0;font-size:13px;color:#0F0F0F;text-align:right;">${INR(order.subtotal)}</td>
        </tr>
        ${discountINR > 0 ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#16a34a;">Discount${order.couponCode ? ` (${order.couponCode})` : ""}</td>
          <td style="padding:6px 0;font-size:13px;color:#16a34a;text-align:right;">−₹${discountINR.toLocaleString("en-IN")}</td>
        </tr>` : ""}
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#666;">Delivery</td>
          <td style="padding:6px 0;font-size:13px;${shippingINR === 0 ? "color:#16a34a;font-weight:600;" : "color:#0F0F0F;"}text-align:right;">${shippingINR === 0 ? "FREE" : "₹" + shippingINR}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding:4px 0;"><div style="height:1px;background:#D4AF37;"></div></td>
        </tr>
        <tr>
          <td style="padding:10px 0 4px;font-size:15px;font-weight:700;color:#0F0F0F;">Total</td>
          <td style="padding:10px 0 4px;font-size:18px;font-weight:700;color:#D4AF37;text-align:right;">₹${totalINR.toLocaleString("en-IN")}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:10px;color:#aaa;letter-spacing:1px;">Inclusive of all taxes</td>
        </tr>
      </table>
    </td>
  </tr>

  ${addr ? `<!-- Shipping address -->
  <tr>
    <td style="padding:24px 40px;background:#FAF8F3;border-top:1px solid #ECE8E1;border-bottom:1px solid #ECE8E1;">
      <h3 style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#888;margin:0 0 12px;">Delivery Address</h3>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#333;">
        <strong style="color:#0F0F0F;">${addr.name}</strong><br>
        ${addr.phone ? `📞 ${addr.phone}<br>` : ""}
        ${addr.line1}<br>
        ${addr.line2 ? addr.line2 + "<br>" : ""}
        ${addr.city}, ${addr.state} – ${addr.postalCode}<br>
        ${addr.country || "India"}
      </p>
    </td>
  </tr>` : ""}

  <!-- Track button -->
  <tr>
    <td style="padding:36px 40px;text-align:center;">
      <a href="${appUrl}/order/${order.id}" style="display:inline-block;background:#0F0F0F;color:#fff;text-decoration:none;padding:16px 44px;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">Track Your Order</a>
      <p style="margin:20px 0 0;font-size:12px;color:#aaa;">Or copy this link: <span style="color:#D4AF37;word-break:break-all;">${appUrl}/order/${order.id}</span></p>
    </td>
  </tr>

  <!-- Footer -->
  <tr><td style="height:2px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>
  <tr>
    <td style="background:#0F0F0F;padding:24px 40px;text-align:center;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#D4AF37;">PEARLIS FINE JEWELLERY</p>
      <p style="margin:0;font-size:11px;color:#666;">If you have any questions, reply to this email or visit pearlis.com</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendOrderConfirmationEmail(order: OrderEmailData, appUrl: string): Promise<boolean> {
  const mg = getClient();
  if (!mg) { console.warn("Mailgun not configured — skipping order confirmation email"); return false; }
  if (!order.customerEmail) { console.warn("No customer email for order", order.id); return false; }
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Fine Jewellery <noreply@${mg.domain}>`,
      to: [order.customerEmail],
      subject: `Order Confirmed — #ORD-${order.id.toString().padStart(6, "0")} | Pearlis`,
      html: orderConfirmationHtml(order, appUrl),
    });
    console.info(`Order confirmation email sent to ${order.customerEmail} for order #${order.id}`);
    return true;
  } catch (err) {
    console.error("Mailgun sendOrderConfirmationEmail error:", err);
    return false;
  }
}

/* ── Order status update email ── */
const STATUS_MESSAGES: Record<string, { subject: string; heading: string; body: string; emoji: string }> = {
  confirmed: {
    subject: "Your Order is Confirmed",
    heading: "Order Confirmed 🎉",
    body: "Great news! Your order has been confirmed and our team is preparing your jewellery with the utmost care.",
    emoji: "✓",
  },
  shipped: {
    subject: "Your Order Has Been Shipped",
    heading: "On Its Way to You ✈️",
    body: "Your Pearlis jewellery has been dispatched and is on its way to you. It should arrive within the estimated delivery window.",
    emoji: "📦",
  },
  delivered: {
    subject: "Your Order Has Been Delivered",
    heading: "Delivered with Love 💛",
    body: "Your Pearlis order has been delivered. We hope you love your new jewellery. If you have any concerns, please don't hesitate to reach out.",
    emoji: "🎁",
  },
  cancelled: {
    subject: "Your Order Has Been Cancelled",
    heading: "Order Cancelled",
    body: "Your order has been cancelled. If this was unexpected or you have any questions, please contact our support team.",
    emoji: "✕",
  },
};

export async function sendOrderStatusEmail(
  to: string,
  customerName: string,
  orderId: number,
  status: string,
  appUrl: string,
): Promise<boolean> {
  const mg = getClient();
  if (!mg || !to) return false;
  const msg = STATUS_MESSAGES[status];
  if (!msg) return false;
  const invoiceNo = orderId.toString().padStart(6, "0");
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Fine Jewellery <noreply@${mg.domain}>`,
      to: [to],
      subject: `${msg.subject} — #ORD-${invoiceNo} | Pearlis`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F1EB;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EB;padding:40px 16px;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8E2D9;">
  <tr><td style="background:#0F0F0F;padding:32px 40px;text-align:center;">
    <div style="font-size:28px;letter-spacing:10px;color:#fff;font-weight:700;margin-bottom:4px;">PEARLIS</div>
    <div style="font-size:10px;letter-spacing:5px;color:#D4AF37;text-transform:uppercase;">Fine Jewellery</div>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>
  <tr><td style="padding:44px 40px;text-align:center;">
    <div style="width:60px;height:60px;background:${status === "cancelled" ? "#fee2e2" : "#D4AF37"};border-radius:50%;margin:0 auto 20px;line-height:60px;font-size:26px;text-align:center;">${msg.emoji}</div>
    <h2 style="font-size:22px;color:#0F0F0F;margin:0 0 8px;font-weight:400;">${msg.heading}</h2>
    <p style="color:#888;font-size:13px;margin:0 0 4px;">Hello, <strong style="color:#0F0F0F;">${customerName}</strong></p>
    <p style="color:#888;font-size:12px;margin:0;">Order <strong style="color:#D4AF37;">#ORD-${invoiceNo}</strong></p>
  </td></tr>
  <tr><td style="padding:0 40px 36px;">
    <div style="background:#FAF8F3;border-left:3px solid #D4AF37;padding:18px 20px;">
      <p style="margin:0;font-size:14px;color:#555;line-height:1.7;">${msg.body}</p>
    </div>
  </td></tr>
  ${status !== "cancelled" ? `<tr><td style="padding:0 40px 40px;text-align:center;">
    <a href="${appUrl}/order/${orderId}" style="display:inline-block;background:#0F0F0F;color:#fff;text-decoration:none;padding:15px 40px;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">Track Order</a>
  </td></tr>` : ""}
  <tr><td style="height:2px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>
  <tr><td style="background:#0F0F0F;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#D4AF37;">PEARLIS FINE JEWELLERY</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
    });
    console.info(`Order status email (${status}) sent to ${to} for order #${orderId}`);
    return true;
  } catch (err) {
    console.error("Mailgun sendOrderStatusEmail error:", err);
    return false;
  }
}

export async function sendStockAlertEmail(to: string, productName: string, productUrl: string): Promise<boolean> {
  const mg = getClient();
  if (!mg) { console.warn("Mailgun not configured — skipping stock alert email"); return false; }
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Fine Jewellery <noreply@${mg.domain}>`,
      to: [to],
      subject: `Back in Stock: ${productName} | Pearlis`,
      html: `
        <div style="font-family:'Georgia',serif;max-width:520px;margin:0 auto;background:#FAF7F2;padding:48px 40px;">
          <h1 style="font-size:28px;letter-spacing:8px;color:#0F0F0F;margin-bottom:4px;">PEARLIS</h1>
          <p style="color:#888;font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-bottom:40px;">Fine Jewellery</p>
          <div style="background:#D4AF37;height:2px;margin-bottom:40px;"></div>
          <h2 style="font-size:22px;color:#0F0F0F;font-weight:normal;margin-bottom:8px;">Good News!</h2>
          <p style="color:#555;font-size:15px;line-height:1.8;margin-bottom:8px;">
            <strong>${productName}</strong> is back in stock and available for purchase.
          </p>
          <p style="color:#888;font-size:13px;line-height:1.6;margin-bottom:32px;">
            Hurry — popular pieces sell out fast. Shop now to secure yours before it's gone again.
          </p>
          <div style="text-align:center;margin-bottom:40px;">
            <a href="${productUrl}" style="display:inline-block;background:#0F0F0F;color:#FAF7F2;text-decoration:none;padding:16px 48px;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">Shop Now</a>
          </div>
          <hr style="border:none;border-top:1px solid #E5E0D8;margin:32px 0;"/>
          <p style="color:#bbb;font-size:11px;letter-spacing:2px;text-align:center;">© PEARLIS FINE JEWELLERY</p>
          <p style="color:#ccc;font-size:10px;text-align:center;margin-top:8px;">You requested to be notified when this item is back in stock.</p>
        </div>
      `,
    });
    console.info(`Stock alert email sent to ${to} for "${productName}"`);
    return true;
  } catch (err) {
    console.error("Mailgun sendStockAlertEmail error:", err);
    return false;
  }
}

export async function sendLowStockAdminAlertEmail(
  to: string,
  products: { name: string; stock: number; id: number }[],
  appUrl: string,
): Promise<boolean> {
  const mg = getClient();
  if (!mg || !to) return false;
  const rows = products.map(p => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #222;font-size:14px;color:#fff;">${p.name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #222;font-size:14px;text-align:center;font-weight:700;color:${p.stock === 0 ? "#ef4444" : "#f59e0b"};">${p.stock === 0 ? "OUT OF STOCK" : p.stock + " left"}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #222;font-size:13px;text-align:right;">
        <a href="${appUrl}/admin/products" style="color:#D4AF37;text-decoration:none;">Edit →</a>
      </td>
    </tr>`).join("");
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Admin <noreply@${mg.domain}>`,
      to: [to],
      subject: `⚠️ Low Stock Alert — ${products.length} product${products.length > 1 ? "s" : ""} need attention | Pearlis`,
      html: `
        <div style="font-family:'Georgia',serif;max-width:560px;margin:0 auto;background:#0F0F0F;padding:0;border:1px solid #222;">
          <div style="background:#0F0F0F;padding:28px 40px;border-bottom:2px solid #D4AF37;text-align:center;">
            <h1 style="font-size:20px;letter-spacing:10px;color:#fff;margin:0;">PEARLIS</h1>
            <p style="color:#D4AF37;font-size:9px;letter-spacing:5px;text-transform:uppercase;margin:4px 0 0;">Admin Alert</p>
          </div>
          <div style="background:#1A1A1A;padding:32px 40px;">
            <div style="background:#f59e0b22;border-left:3px solid #f59e0b;padding:14px 18px;margin-bottom:24px;">
              <p style="margin:0;font-size:14px;color:#f59e0b;font-weight:bold;">⚠️ Low Stock Warning</p>
              <p style="margin:6px 0 0;font-size:13px;color:#aaa;">The following product${products.length > 1 ? "s are" : " is"} running low and may need restocking.</p>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #333;">
              <thead>
                <tr style="background:#111;">
                  <th style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;font-weight:600;text-align:left;">Product</th>
                  <th style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;font-weight:600;text-align:center;">Stock</th>
                  <th style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;font-weight:600;text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div style="background:#0F0F0F;padding:20px 40px;text-align:center;border-top:1px solid #222;">
            <a href="${appUrl}/admin/stock-alerts" style="display:inline-block;background:#D4AF37;color:#0F0F0F;text-decoration:none;padding:12px 32px;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:bold;">View Stock Alerts</a>
          </div>
        </div>
      `,
    });
    console.info(`Low stock admin alert sent to ${to} for ${products.length} products`);
    return true;
  } catch (err) {
    console.error("Mailgun sendLowStockAdminAlertEmail error:", err);
    return false;
  }
}

/* ── Return request status email ── */
const RETURN_STATUS_CONFIG: Record<string, { subject: string; heading: string; color: string; emoji: string; body: string }> = {
  approved: {
    subject: "Your Return Request Has Been Approved",
    heading: "Return Approved ✓",
    color: "#16a34a",
    emoji: "✓",
    body: "Great news! We have reviewed your return request and it has been approved. Our team will process your refund within 5–7 business days. The amount will be credited back to your original payment method.",
  },
  rejected: {
    subject: "Update on Your Return Request",
    heading: "Return Request Update",
    color: "#ef4444",
    emoji: "✕",
    body: "We have reviewed your return request and unfortunately we are unable to approve it at this time. Please see the note from our team below.",
  },
};

export async function sendReturnRequestStatusEmail(
  to: string,
  customerName: string,
  orderId: number,
  status: string,
  adminNote: string | null,
  appUrl: string,
): Promise<boolean> {
  const mg = getClient();
  if (!mg || !to) return false;
  const cfg = RETURN_STATUS_CONFIG[status];
  if (!cfg) return false;
  const invoiceNo = orderId.toString().padStart(6, "0");
  try {
    await mg.client.messages.create(mg.domain, {
      from: `Pearlis Fine Jewellery <noreply@${mg.domain}>`,
      to: [to],
      subject: `${cfg.subject} — #ORD-${invoiceNo} | Pearlis`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F1EB;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EB;padding:40px 16px;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8E2D9;">

  <tr><td style="background:#0F0F0F;padding:32px 40px;text-align:center;">
    <div style="font-size:28px;letter-spacing:10px;color:#fff;font-weight:700;margin-bottom:4px;">PEARLIS</div>
    <div style="font-size:10px;letter-spacing:5px;color:#D4AF37;text-transform:uppercase;">Fine Jewellery</div>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>

  <tr><td style="padding:44px 40px 28px;text-align:center;">
    <div style="width:60px;height:60px;background:${cfg.color};border-radius:50%;margin:0 auto 20px;line-height:60px;font-size:26px;text-align:center;color:#fff;font-weight:bold;">${cfg.emoji}</div>
    <h2 style="font-size:22px;color:#0F0F0F;margin:0 0 10px;font-weight:400;">${cfg.heading}</h2>
    <p style="color:#888;font-size:13px;margin:0 0 4px;">Hello, <strong style="color:#0F0F0F;">${customerName}</strong></p>
    <p style="color:#888;font-size:12px;margin:0;">Return request for order <strong style="color:#D4AF37;">#ORD-${invoiceNo}</strong></p>
  </td></tr>

  <tr><td style="padding:0 40px 28px;">
    <div style="background:#FAF8F3;border-left:3px solid ${cfg.color};padding:18px 20px;">
      <p style="margin:0;font-size:14px;color:#555;line-height:1.7;">${cfg.body}</p>
    </div>
  </td></tr>

  ${adminNote ? `<tr><td style="padding:0 40px 28px;">
    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;margin:0 0 10px;">Note from our team</p>
    <div style="background:#fff;border:1px solid #E8E2D9;padding:16px 20px;border-radius:2px;">
      <p style="margin:0;font-size:14px;color:#333;line-height:1.7;font-style:italic;">"${adminNote}"</p>
    </div>
  </td></tr>` : ""}

  <tr><td style="padding:0 40px 40px;text-align:center;">
    <a href="${appUrl}/account" style="display:inline-block;background:#0F0F0F;color:#fff;text-decoration:none;padding:15px 40px;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-weight:bold;">View My Orders</a>
  </td></tr>

  <tr><td style="height:2px;background:linear-gradient(90deg,#B8960C,#D4AF37,#F0CF60,#D4AF37,#B8960C);"></td></tr>
  <tr><td style="background:#0F0F0F;padding:20px 40px;text-align:center;">
    <p style="margin:0 0 4px;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#D4AF37;">PEARLIS FINE JEWELLERY</p>
    <p style="margin:0;font-size:11px;color:#555;">Questions? Reply to this email or contact our support team.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`,
    });
    console.info(`Return request status email (${status}) sent to ${to} for order #${orderId}`);
    return true;
  } catch (err) {
    console.error("Mailgun sendReturnRequestStatusEmail error:", err);
    return false;
  }
}
