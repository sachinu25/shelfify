import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = env.emailEnabled
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
    : // Without SMTP credentials messages are rendered and logged, never silently dropped.
      nodemailer.createTransport({ jsonTransport: true });
  return transporter;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f6f1e9;font-family:Georgia,'Times New Roman',serif;color:#1c1917">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e7dfd2;border-radius:14px">
  <tr><td style="padding:28px 32px;border-bottom:1px solid #eee5d8">
    <div style="font-size:24px;letter-spacing:.5px"><b>Shelfify</b></div>
    <div style="font:12px Arial,sans-serif;color:#8a7f72;text-transform:uppercase;letter-spacing:2px">Independent online bookstore</div>
  </td></tr>
  <tr><td style="padding:28px 32px;font:15px/1.6 Arial,sans-serif;color:#2d2a26">
    <h1 style="font:600 22px Georgia,serif;margin:0 0 16px">${esc(title)}</h1>
    ${body}
  </td></tr>
  <tr><td style="padding:18px 32px;border-top:1px solid #eee5d8;font:12px Arial,sans-serif;color:#8a7f72">
    You are receiving this email because of activity on your Shelfify account.
  </td></tr></table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#5b1f2a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc(label)}</a></p>`;

function itemsTable(order) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f0e8dc">${esc(i.title)} <span style="color:#8a7f72">× ${i.quantity}</span></td>
         <td align="right" style="padding:8px 0;border-bottom:1px solid #f0e8dc">${inr(i.price * i.quantity)}</td></tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0">${rows}
    <tr><td style="padding:8px 0">Shipping</td><td align="right">${inr(order.pricing.shipping)}</td></tr>
    ${order.pricing.couponDiscount ? `<tr><td style="padding:8px 0">Coupon (${esc(order.coupon?.code)})</td><td align="right">−${inr(order.pricing.couponDiscount)}</td></tr>` : ''}
    <tr><td style="padding:8px 0"><b>Total paid</b></td><td align="right"><b>${inr(order.pricing.total)}</b></td></tr></table>`;
}

const STATUS_COPY = {
  processing: 'is being packed',
  shipped: 'has shipped',
  out_for_delivery: 'is out for delivery',
  delivered: 'has been delivered',
  cancelled: 'has been cancelled',
  refunded: 'has been refunded',
};

export const templates = {
  welcome: (user) => ({
    subject: 'Welcome to Shelfify',
    html: layout(
      `Welcome, ${user.name.split(' ')[0]}`,
      `<p>Your account is ready. Build your wishlist, follow your favourite genres and we'll recommend books you'll love.</p>${button(`${env.clientUrl}/shop`, 'Start browsing')}`,
    ),
  }),
  passwordReset: (user, url) => ({
    subject: 'Reset your Shelfify password',
    html: layout(
      'Password reset requested',
      `<p>Hi ${esc(user.name)}, we received a request to reset your password. This link expires in 30 minutes.</p>${button(url, 'Reset password')}<p style="color:#8a7f72">If you didn't request this you can safely ignore this email.</p>`,
    ),
  }),
  orderConfirmed: (user, order) => ({
    subject: `Order ${order.orderNumber} confirmed`,
    html: layout(
      'Thank you for your order',
      `<p>Hi ${esc(user.name)}, we've received your payment for order <b>${esc(order.orderNumber)}</b>.</p>${itemsTable(order)}${button(`${env.clientUrl}/orders/${order._id}`, 'Track your order')}`,
    ),
  }),
  orderStatus: (user, order) => ({
    subject: `Order ${order.orderNumber} ${STATUS_COPY[order.status] || 'was updated'}`,
    html: layout(
      `Your order ${STATUS_COPY[order.status] || 'was updated'}`,
      `<p>Hi ${esc(user.name)}, order <b>${esc(order.orderNumber)}</b> ${STATUS_COPY[order.status] || 'was updated'}.</p>
       ${order.tracking?.carrier ? `<p>Carrier: <b>${esc(order.tracking.carrier)}</b> &middot; Tracking #: <b>${esc(order.tracking.number)}</b></p>` : ''}
       ${button(`${env.clientUrl}/orders/${order._id}`, 'View order')}`,
    ),
  }),
};

/** Fire-and-log: email failures must never break the business transaction. */
export async function sendEmail(to, { subject, html }) {
  try {
    const info = await getTransporter().sendMail({ from: env.EMAIL_FROM, to, subject, html });
    logger.info({ to, subject, messageId: info.messageId, delivered: env.emailEnabled }, 'email dispatched');
    return true;
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'email failed');
    return false;
  }
}
