import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationService {
  generateCorrelationId(): string {
    return `req_${uuidv4()}`;
  }
}
