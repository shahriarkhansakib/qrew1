/**
 * Opaque transaction handle passed across framework-free domain/application boundaries.
 * Concrete infrastructure repositories unwrap this handle via DbContext helpers.
 */
export interface TransactionContext {
  readonly __txBrand: 'QrewTransactionContext';
}

export interface UnitOfWorkPort {
  execute<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
  executeWithAdvisoryLock<T>(
    lockKey: number,
    fn: (tx: TransactionContext) => Promise<T>,
  ): Promise<T>;
}
