import { Kubernetes } from 'k6/x/kubernetes';
import chai, { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';

chai.config.aggregateChecks = false;

const CLUSTER_ADMIN = 't-rbac-kac-cluster-admin';
const NS_ADMIN = 't-rbac-kac-ns-admin';
const NS_VIEWER = 't-rbac-kac-ns-viewer';

let k8s;

export default function () {
  describe(CLUSTER_ADMIN, () => {
    expectCanI(CLUSTER_ADMIN, { verb: '*', resource: '*' }, 'yes');
  });

  describe(NS_ADMIN, () => {
    expectCanI(NS_ADMIN, { verb: 'create', resource: 'pods', subresource: 'exec' }, 'no');
    expectCanI(NS_ADMIN, { verb: 'create', resource: 'pods', subresource: 'portforward' }, 'no');
    expectCanI(NS_ADMIN, { verb: 'get', resource: 'secrets' }, 'yes');
  });

  describe(NS_VIEWER, () => {
    expectCanI(NS_VIEWER, { verb: 'get', resource: 'pods' }, 'yes');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods', subresource: 'exec' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods', subresource: 'portforward' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'get', resource: 'secrets' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'delete', resource: 'pods' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'deletecollection', resource: 'pods' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'patch', resource: 'pods' }, 'no');
    expectCanI(NS_VIEWER, { verb: 'update', resource: 'pods' }, 'no');
  });
}

function expectCanI(group, attrs, allowed) {
  const name = [attrs.verb, attrs.resource, attrs.subresource].filter(Boolean).join(' ');
  describe(`${allowed === 'yes' ? 'should allow' : 'should deny'} ${name}`, () => {
    expect(canI(group, attrs), name).to.equal(allowed);
  });
}

function canI(group, attrs) {
  if (!k8s) k8s = new Kubernetes();
  const sar = k8s.create({
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SubjectAccessReview',
    spec: {
      groups: [group],
      resourceAttributes: {
        group: attrs.group,
        resource: attrs.resource,
        subresource: attrs.subresource,
        verb: attrs.verb,
        // namespace: 'payments',
      },
    },
  });
  return sar.status && sar.status.allowed ? 'yes' : 'no';
}
