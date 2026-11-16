import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

// Development-only transport: prints messages to the API console so a local
// developer can follow the verification link. Real delivery moves to the
// outbox and email worker in M4; production refuses to start without it.
@Injectable()
export class DevelopmentConsoleMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  async send(message: MailMessage): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('No production mail transport is configured');
    }
    this.logger.log(
      `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}
