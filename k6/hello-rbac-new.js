import { Kubernetes } from 'k6/x/kubernetes';
import chai, { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';

chai.config.aggregateChecks = false;

const CLUSTER_ADMIN = 't-rbac-kac-cluster-admin';
const NS_ADMIN = 't-rbac-kac-ns-admin';
const NS_VIEWER = 't-rbac-kac-ns-viewer';

let k8s;

export default function () {
  describe(CLUSTER_ADMIN, () => {
    expectCanI(CLUSTER_ADMIN, { verb: '*', resource: '*' }).to.equal('yes');
  });

  describe(NS_ADMIN, () => {
    expectCanI(NS_ADMIN, { verb: 'create', resource: 'pods', subresource: 'exec' }).to.equal('no');
    expectCanI(NS_ADMIN, { verb: 'create', resource: 'pods', subresource: 'portforward' }).to.equal('no');
    expectCanI(NS_ADMIN, { verb: 'get', resource: 'secrets' }).to.equal('yes');
  });

  describe(NS_VIEWER, () => {
    expectCanI(NS_VIEWER, { verb: 'get', resource: 'pods' }).to.equal('yes');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods', subresource: 'exec' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods', subresource: 'portforward' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'get', resource: 'secrets' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'create', resource: 'pods' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'delete', resource: 'pods' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'deletecollection', resource: 'pods' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'patch', resource: 'pods' }).to.equal('no');
    expectCanI(NS_VIEWER, { verb: 'update', resource: 'pods' }).to.equal('no');
  });
}

function expectCanI(group, attrs) {
  const question = label(attrs);
  return {
    to: {
      equal(allowed) {
        const title = allowed === 'yes' ? `should allow ${question}` : `should deny ${question}`;
        describe(title, () => {
          expect(canI(group, attrs), question).to.equal(allowed);
        });
      },
    },
  };
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
        namespace: 'payments',
      },
    },
  });
  return sar.status && sar.status.allowed ? 'yes' : 'no';
}

function label(attrs) {
  const type = attrs.group ? `${attrs.resource}.${attrs.group}` : attrs.resource;
  let q = `${attrs.verb} ${type}`;
  if (attrs.subresource) q += ` --subresource=${attrs.subresource}`;
  return q;
}
