const nodemailer = require('nodemailer');

module.exports = async ({ to, subject, text, html }) => {
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: '"NEXIS" <no-reply@nexisapp.com>',
    to,
    subject,
    text,
    html
  });
};