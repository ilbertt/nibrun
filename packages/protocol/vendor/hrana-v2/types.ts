type int32 = number;

type CloseStreamReq = {
    "type": "close",
}

type Value =
    | { "type": "null" }
    | { "type": "integer", "value": string }
    | { "type": "float", "value": number }
    | { "type": "text", "value": string }
    | { "type": "blob", "base64": string }

type NamedArg = {
    "name": string,
    "value": Value,
}

type Stmt = {
    "sql"?: string | undefined,
    "sql_id"?: int32 | undefined,
    "args"?: Array<Value>,
    "named_args"?: Array<NamedArg>,
    "want_rows"?: boolean,
}

type ExecuteStreamReq = {
    "type": "execute",
    "stmt": Stmt,
}

type BatchCond =
    | { "type": "ok", "step": int32 }
    | { "type": "error", "step": int32 }
    | { "type": "not", "cond": BatchCond }
    | { "type": "and", "conds": Array<BatchCond> }
    | { "type": "or", "conds": Array<BatchCond> }

type BatchStep = {
    "condition"?: BatchCond | null,
    "stmt": Stmt,
}

type Batch = {
    "steps": Array<BatchStep>,
}

type BatchStreamReq = {
    "type": "batch",
    "batch": Batch,
}

type SequenceStreamReq = {
    "type": "sequence",
    "sql"?: string | null,
    "sql_id"?: int32 | null,
}

type DescribeStreamReq = {
    "type": "describe",
    "sql"?: string | null,
    "sql_id"?: int32 | null,
}

type StoreSqlStreamReq = {
    "type": "store_sql",
    "sql_id": int32,
    "sql": string,
}

type CloseSqlStreamReq = {
    "type": "close_sql",
    "sql_id": int32,
}

type StreamRequest =
    | CloseStreamReq
    | ExecuteStreamReq
    | BatchStreamReq
    | SequenceStreamReq
    | DescribeStreamReq
    | StoreSqlStreamReq
    | CloseSqlStreamReq

type PipelineReqBody = {
    "baton": string | null,
    "requests": Array<StreamRequest>,
}

type CloseStreamResp = {
    "type": "close",
}

type Col = {
    "name": string | null,
    "decltype": string | null,
}

type StmtResult = {
    "cols": Array<Col>,
    "rows": Array<Array<Value>>,
    "affected_row_count": int32,
    "last_insert_rowid": string | null,
}

type ExecuteStreamResp = {
    "type": "execute",
    "result": StmtResult,
}

type Error = {
    "message": string,
    "code"?: string | null,
}

type BatchResult = {
    "step_results": Array<StmtResult | null>,
    "step_errors": Array<Error | null>,
}

type BatchStreamResp = {
    "type": "batch",
    "result": BatchResult,
}

type SequenceStreamResp = {
    "type": "sequence",
}

type DescribeParam = {
    "name": string | null,
}

type DescribeCol = {
    "name": string,
    "decltype": string | null,
}

type DescribeResult = {
    "params": Array<DescribeParam>,
    "cols": Array<DescribeCol>,
    "is_explain": boolean,
    "is_readonly": boolean,
}

type DescribeStreamResp = {
    "type": "describe",
    "result": DescribeResult,
}

type StoreSqlStreamResp = {
    "type": "store_sql",
}

type CloseSqlStreamResp = {
    "type": "close_sql",
}

type StreamResponse =
    | CloseStreamResp
    | ExecuteStreamResp
    | BatchStreamResp
    | SequenceStreamResp
    | DescribeStreamResp
    | StoreSqlStreamResp
    | CloseSqlStreamResp

type StreamResultOk = {
    "type": "ok",
    "response": StreamResponse,
}

type StreamResultError = {
    "type": "error",
    "error": Error,
}

type StreamResult =
    | StreamResultOk
    | StreamResultError

type PipelineRespBody = {
    "baton": string | null,
    "base_url": string | null,
    "results": Array<StreamResult>
}
