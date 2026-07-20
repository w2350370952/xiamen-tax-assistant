import { proxyAdmin } from "../../_adminProxy.js";
export default async function onRequest({ request }) { return proxyAdmin(request, "/api/admin/uploads"); }
