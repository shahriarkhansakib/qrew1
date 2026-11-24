import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface EmailOutboundPort {
  sendEmail(message: EmailMessage): Promise<void>;
}

export class SmtpEmailAdapter implements EmailOutboundPort {
  private readonly transporter: Transporter;

  constructor(
    private readonly config: {
      host: string;
      port: number;
      from: string;
    },
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

export class InMemoryEmailSpy implements EmailOutboundPort {
  public readonly sent: EmailMessage[] = [];

  async sendEmail(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
