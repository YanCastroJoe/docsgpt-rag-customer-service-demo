\set ON_ERROR_STOP on

UPDATE prompts
SET content = $prompt$
你是企业知识库智能客服助手。系统会提供用户问题和检索出的 Sources/知识库片段。

必须遵守：
1. 只能依据 Sources 回答，不得使用模型常识、法律常识、其他平台经验或猜测补充答案。
2. 先判断 Sources 是否直接覆盖用户问题。只有片段中明确出现的责任方、金额、时效、条件和流程才可作答。
3. 如果 Sources 与问题不相关，或缺少问题要求的关键事实，只回答：“当前知识库中未找到相关信息，建议联系人工客服确认。”不要再补充一般性结论。
4. 如果问题包含多个事项，只回答有直接依据的事项；其余事项使用上述统一拒答句。
5. 不得把来源标题相似当作内容相关，不得引用 Sources 之外的法律法规或网页。

本次检索到的 Sources：
{summaries}

回答格式：
- 第一行直接给出结论；
- 第二行列出关键条件或注意事项；
- 有直接依据时，最后一行写“来源：<实际命中的文件名> · <相关章节或片段主题>”；
- 使用统一拒答模板时只输出拒答句，不得添加“来源”行；
- 内容简洁、专业，不展示推理过程。
$prompt$,
    updated_at = now()
WHERE name = '企业客服RAG回答模板';

UPDATE agents
SET chunks = 2,
    retriever = 'hybrid',
    key = :'agent_api_key',
    extra_source_ids = ARRAY[
      :'source_id'::uuid
    ],
    prompt_id = (
      SELECT id FROM prompts
      WHERE name = '企业客服RAG回答模板'
      ORDER BY updated_at DESC
      LIMIT 1
    ),
    shared = true,
    shared_token = :'shared_agent_token',
    shared_metadata = jsonb_build_object('shared_by', 'Demo', 'purpose', 'interview_demo'),
    updated_at = now()
WHERE id = :'agent_id'::uuid;

UPDATE sources
SET retriever = 'hybrid',
    config = jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{retrieval}',
      COALESCE(config -> 'retrieval', '{}'::jsonb)
        || '{"retriever":"hybrid","rephrase_query":false}'::jsonb,
      true
    ),
    updated_at = now()
WHERE id = ANY (
  SELECT unnest(extra_source_ids)
  FROM agents
  WHERE id = :'agent_id'::uuid
);

-- psql does not expand :variables inside a dollar-quoted PL/pgSQL block.
-- Store the identifier as a session-scoped custom setting so the independent
-- verification block can still fail the deployment atomically on a mismatch.
SELECT set_config('docsgpt.deploy_agent_id', :'agent_id', false) IS NOT NULL
  AS deploy_agent_id_set;
SELECT set_config('docsgpt.deploy_agent_key', :'agent_api_key', false) IS NOT NULL
  AS deploy_agent_key_set;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agents
    WHERE id = current_setting('docsgpt.deploy_agent_id')::uuid
      AND chunks = 2
      AND retriever = 'hybrid'
      AND key = current_setting('docsgpt.deploy_agent_key')
      AND prompt_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Public V3 agent configuration was not applied';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM sources
    WHERE id = ANY (
      SELECT unnest(extra_source_ids)
      FROM agents
      WHERE id = current_setting('docsgpt.deploy_agent_id')::uuid
    )
      AND COALESCE(config #>> '{retrieval,retriever}', '') <> 'hybrid'
  ) THEN
    RAISE EXCEPTION 'Public V3 source retrieval configuration was not applied';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM sources
    WHERE id = ANY (
      SELECT unnest(extra_source_ids)
      FROM agents
      WHERE id = current_setting('docsgpt.deploy_agent_id')::uuid
    )
      AND COALESCE((config #>> '{retrieval,rephrase_query}')::boolean, true)
  ) THEN
    RAISE EXCEPTION 'Public V3 source query rewriting was not disabled';
  END IF;
END
$verify$;
