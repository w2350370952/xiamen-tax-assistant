import { proxyAdmin } from "../../../_adminProxy.js";
export default async function onRequest({ request, params }) { return proxyAdmin(request, `/api/admin/drafts/${encodeURIComponent(params.id)}`); }
