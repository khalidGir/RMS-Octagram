export interface Money {
  amountMinor: bigint;
  currency: string;
}

export interface PaginationParams {
  limit?: number;
  after?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    nextCursor?: string;
    hasMore: boolean;
    requestId: string;
  };
}

export interface SuccessResponse<T> {
  data: T;
  meta: {
    requestId: string;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    requestId: string;
  };
}
