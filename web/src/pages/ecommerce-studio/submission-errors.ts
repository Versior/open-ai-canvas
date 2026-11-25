import { ApiError } from "@/services/api/request";

export function commerceSubmissionRejected(cause: unknown): cause is ApiError {
    if (!(cause instanceof ApiError) || cause.status === undefined || cause.status < 400 || cause.status >= 500 || cause.status === 408 || commerceSubmissionKeyConflict(cause)) return false;
    return cause.status !== 429 || cause.details?.taskCreated === false;
}

export function commerceSubmissionKeyConflict(cause: unknown) {
    return cause instanceof ApiError && cause.code === 40901;
}

export function studioDetailContractRejected(cause: unknown) {
    return cause instanceof ApiError && cause.reason === "studio_detail_contract_outdated";
}
