-- Track which model/provider a DLQ message came from, so replay routes to the correct queue.
ALTER TABLE dlq_messages ADD COLUMN eval_model TEXT;
ALTER TABLE dlq_messages ADD COLUMN eval_provider TEXT;
