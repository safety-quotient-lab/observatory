-- Track the model and prompt used for each evaluation
ALTER TABLE stories ADD COLUMN eval_model TEXT;
ALTER TABLE stories ADD COLUMN eval_prompt_hash TEXT;
ALTER TABLE stories ADD COLUMN eval_system_prompt TEXT;
ALTER TABLE stories ADD COLUMN eval_user_prompt TEXT;
