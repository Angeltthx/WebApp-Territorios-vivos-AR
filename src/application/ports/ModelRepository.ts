import type { ArModel } from '@domain/entities/ArModel';
import type { ModelId } from '@domain/value-objects/ModelId';

export interface ModelRepository {
  findById(id: ModelId): Promise<ArModel | null>;
  findAll(): Promise<readonly ArModel[]>;
}
