const nodemailer = require("nodemailer");
const logger = require("./logger");
const {
  rejectionEmailTemplate,
  interviewInvitationEmailTemplate,
  verificationEmailTemplate,
  passwordResetEmailTemplate,
  otpEmailTemplate,
  workspaceReadyEmailTemplate,
} = require("./emailTemplates");

let transporterPromise = null;

function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (process.env.SMTP_HOST) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
    );
  } else {
    // No SMTP configured (dev/local): use a JSON transport so mail composition
    // is exercised end-to-end without needing real credentials or sending anything.
    transporterPromise = Promise.resolve(nodemailer.createTransport({ jsonTransport: true }));
  }

  return transporterPromise;
}

async function sendMail({ to, subject, text, html }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || "no-reply@recruitment.local",
    to,
    subject,
    text,
    html,
  });

  if (!process.env.SMTP_HOST) {
    // Dev fallback: no SMTP configured, so NOTHING was actually sent — but the caller (and
    // EmailLog) will record it as sent. Printing the full body is deliberate and is how you
    // retrieve a verification link or OTP locally, the same way Laravel's "log" mail driver
    // or Rails' letter_opener work.
    //
    // The bodies of the verification / password-reset / OTP mails contain live credentials,
    // so this must never run in production. `validateEnv` now hard-fails a production boot
    // with no SMTP_HOST; this second guard means that even if that check is bypassed, the
    // secret is not written to a production log aggregator.
    const line = `[mailer] no SMTP configured — NOT SENT. to=${to} subject="${subject}"`;
    if (process.env.NODE_ENV === "production") {
      logger.error(`${line} (body withheld in production)`);
    } else {
      logger.warn(`${line}\n${text}`);
    }
  }

  return info;
}

async function sendRejectionEmail(candidate, job) {
  const { subject, text, html } = rejectionEmailTemplate(candidate, job);
  return sendMail({ to: candidate.basicDetails.email, subject, text, html });
}

async function sendInterviewInvitationEmail(candidate, job, session) {
  const { subject, text, html } = interviewInvitationEmailTemplate(candidate, job, session);
  return sendMail({ to: candidate.basicDetails.email, subject, text, html });
}

async function sendVerificationEmail(user, verifyUrl) {
  const { subject, text, html } = verificationEmailTemplate(user, verifyUrl);
  return sendMail({ to: user.email, subject, text, html });
}

async function sendPasswordResetEmail(user, resetUrl) {
  const { subject, text, html } = passwordResetEmailTemplate(user, resetUrl);
  return sendMail({ to: user.email, subject, text, html });
}

async function sendOtpEmail(email, companyName, otp) {
  const { subject, text, html } = otpEmailTemplate(companyName, otp);
  return sendMail({ to: email, subject, text, html });
}

async function sendWorkspaceReadyEmail(email, company, adminName) {
  const { subject, text, html } = workspaceReadyEmailTemplate(company, adminName);
  return sendMail({ to: email, subject, text, html });
}

module.exports = {
  sendMail,
  sendRejectionEmail,
  sendInterviewInvitationEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOtpEmail,
  sendWorkspaceReadyEmail,
};
