import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse_exception } from "../scripts/parse_exception.ts";

const JAVA = `java.lang.NullPointerException: order is null
	at com.example.order.OrderService.checkout(OrderService.java:42)
	at com.example.order.OrderController.create(OrderController.java:18)
	at org.springframework.web.servlet.FrameworkServlet.service(FrameworkServlet.java:123)
	at java.base/java.lang.Thread.run(Thread.java:840)
Caused by: java.lang.IllegalStateException: cart empty
	at com.example.order.CartGuard.require(CartGuard.java:9)
`;

const PYTHON = `Traceback (most recent call last):
  File "app.py", line 10, in main
    foo()
  File "svc.py", line 5, in checkout
    raise ValueError("order is null")
ValueError: order is null
`;

const NODE = `TypeError: Cannot read properties of null (reading 'id')
    at Object.checkout (/src/order.js:12:11)
    at create (/src/controller.js:4:5)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
`;

describe("parse_exception java", () => {
  it("extracts type, message, caused-by, and app frames", () => {
    const parsed = parse_exception(JAVA);
    assert.equal(parsed.exceptionType, "java.lang.NullPointerException");
    assert.equal(parsed.message, "order is null");
    assert.equal(parsed.causes.length, 1);
    assert.equal(parsed.causes[0].exceptionType, "java.lang.IllegalStateException");
    assert.equal(parsed.primaryFrame?.className, "com.example.order.OrderService");
    assert.equal(parsed.primaryFrame?.methodName, "checkout");
    assert.equal(parsed.primaryFrame?.line, 42);
    assert.equal(parsed.primaryFrame?.key, "OrderService#checkout");
    assert.equal(parsed.appFrames.length, 3);
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("springframework")));
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("java.lang.Thread")));
  });
});

describe("parse_exception python", () => {
  it("extracts traceback frames and ValueError", () => {
    const parsed = parse_exception(PYTHON);
    assert.equal(parsed.exceptionType, "ValueError");
    assert.equal(parsed.message, "order is null");
    assert.equal(parsed.primaryFrame?.file, "svc.py");
    assert.equal(parsed.primaryFrame?.methodName, "checkout");
    assert.ok(parsed.appFrames.some((f) => f.methodName === "checkout" && f.line === 5));
  });
});

describe("parse_exception node", () => {
  it("skips node internals and keeps app frames", () => {
    const parsed = parse_exception(NODE);
    assert.equal(parsed.exceptionType, "TypeError");
    assert.match(parsed.message || "", /Cannot read properties/);
    assert.equal(parsed.primaryFrame?.methodName, "checkout");
    assert.equal(parsed.primaryFrame?.file, "/src/order.js");
    assert.equal(parsed.primaryFrame?.line, 12);
    assert.ok(!parsed.appFrames.some((f) => /task_queues/.test(f.file || "")));
  });
});

describe("parse_exception java deadlock stack", () => {
  it("keeps sankuai frames and drops jdbc/druid/zebra", () => {
    const parsed = parse_exception(`java.sql.SQLException: Deadlock found when trying to get lock
	at com.mysql.jdbc.SQLError.createSQLException(SQLError.java:1074)
	at com.alibaba.druid.pool.DruidPooledPreparedStatement.executeQuery(DruidPooledPreparedStatement.java:227)
	at com.dianping.zebra.group.jdbc.GroupPreparedStatement.executeQuery(GroupPreparedStatement.java:74)
	at com.sankuai.meituan.banma.desp.common.base.repository.impl.BmWaybillMySQLRepositoryImpl.batchBriefByRiderIdAndStatuses(BmWaybillMySQLRepositoryImpl.java:178)
	... (后续同上 → RiderDistributionTaskSearchService → ThriftServiceIfaceImpl)
`);
    assert.ok(parsed.appFrames.every((f) => !String(f.className).includes("mysql")));
    assert.ok(parsed.appFrames.every((f) => !String(f.className).includes("druid")));
    assert.ok(parsed.appFrames.every((f) => !String(f.className).includes("zebra")));
    assert.ok(parsed.appFrames.some((f) => f.key === "BmWaybillMySQLRepositoryImpl#batchBriefByRiderIdAndStatuses"));
    assert.ok(parsed.appFrames.some((f) => f.className === "RiderDistributionTaskSearchService"));
    assert.ok(parsed.appFrames.some((f) => f.className === "ThriftServiceIfaceImpl"));
    assert.ok(parsed.appFrames.every((f) => f.methodName !== "search" || f.line !== 1));
  });

  it("treats RPC client interceptors and $Client stubs as library", () => {
    const parsed = parse_exception(`org.apache.thrift.TException: mtthrift remote(10.147.23.189:8080) invoke(getUser) method timeout
	at com.meituan.service.mobile.mtthrift.client.invoker.MTThriftMethodInterceptor.invoke(MTThriftMethodInterceptor.java:215)
	at com.sun.proxy.$Proxy382.getUser(Unknown Source)
	at com.example.staff.BmUserQueryIface$Client.getUser(BmUserQueryIface.java:472)
	at com.example.app.UserProxy.getUser(UserProxy.java:29)
	at com.example.app.UserService.getUser(UserService.java:15)
	at com.meituan.service.mobile.mtthrift.server.netty.DefaultServerHandler$1.run(DefaultServerHandler.java:63)
	at java.lang.Thread.run(Thread.java:748)
Caused by: java.net.SocketTimeoutException: Read timed out
	at java.net.SocketInputStream.socketRead0(Native Method)
`);
    assert.equal(parsed.primaryFrame?.key, "UserProxy#getUser");
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("MTThriftMethodInterceptor")));
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("$Client")));
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("DefaultServerHandler")));
    assert.ok(parsed.appFrames.every((f) => !String(f.className).includes("mtthrift")));
  });

  it("marks thrift Filter/Interceptor frames as library", () => {
    const parsed = parse_exception(`java.lang.Exception: boom
	at com.sankuai.meituan.banma.desp.common.thrift.TRPCAsyncFilter.proxyInvoke(TRPCAsyncFilter.java:30)
	at com.example.app.UserProxy.getUser(UserProxy.java:29)
`);
    assert.equal(parsed.primaryFrame?.key, "UserProxy#getUser");
    assert.ok(parsed.frames.some((f) => f.library && String(f.className).includes("TRPCAsyncFilter")));
  });

  it("collapses invented Class#search:1 into class-only when arrows exist", () => {
    const parsed = parse_exception(`java.sql.SQLException: deadlock
	at com.sankuai.deliverywaybill.desp.rider.component.search.AbstractSearcher.search(AbstractSearcher.java:173)
	at com.sankuai.deliverywaybill.desp.rider.service.RiderDistributionTaskSearchService.search(RiderDistributionTaskSearchService.java:1)
	at com.sankuai.deliverywaybill.desp.rider.thrift.ThriftServiceIfaceImpl.search(ThriftServiceIfaceImpl.java:1)
	... (后续同上 → RiderDistributionTaskSearchService → ThriftServiceIfaceImpl)
`);
    const rider = parsed.appFrames.find((f) => String(f.className).includes("RiderDistributionTaskSearchService"));
    const thrift = parsed.appFrames.find((f) => String(f.className).includes("ThriftServiceIfaceImpl"));
    assert.equal(rider?.methodName, null);
    assert.equal(rider?.line, null);
    assert.equal(thrift?.methodName, null);
    assert.ok(parsed.appFrames.some((f) => f.key === "AbstractSearcher#search"));
  });
});

describe("parse_exception generic", () => {
  it("picks file:line from debug prints", () => {
    const parsed = parse_exception("boom at src/Foo.kt:88 while loading");
    assert.equal(parsed.primaryFrame?.file, "src/Foo.kt");
    assert.equal(parsed.primaryFrame?.line, 88);
  });
});
