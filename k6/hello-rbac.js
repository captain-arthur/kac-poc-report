import http from 'k6/http';
import encoding from 'k6/encoding';
import chai, { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs';

chai.config.aggregateChecks = false;

const USER = 'kac-can-i';
const CLUSTER_ADMIN = 't-rbac-kac-cluster-admin';
const NS_ADMIN = 't-rbac-kac-ns-admin';
const NS_VIEWER = 't-rbac-kac-ns-viewer';
const PAYMENTS = 'payments';

const kubeconfig = yaml.load(open(__ENV.KUBECONFIG || `${__ENV.HOME}/.kube/config`));
const context = kubeconfig.contexts.find((c) => c.name === kubeconfig['current-context']).context;
const cluster = kubeconfig.clusters.find((c) => c.name === context.cluster).cluster;
const user = kubeconfig.users.find((u) => u.name === context.user).user;
const headers = { Accept: 'application/json' };
if (user.token) headers.Authorization = `Bearer ${user.token}`;
const kube = {
  server: cluster.server.replace(/\/$/, ''),
  cert: user['client-certificate-data'] ? encoding.b64decode(user['client-certificate-data'], 'std', 's') : undefined,
  key: user['client-key-data'] ? encoding.b64decode(user['client-key-data'], 'std', 's') : undefined,
  headers,
};

export const options = {
  vus: 1,
  iterations: 1,
  insecureSkipTLSVerify: true,
  tlsAuth: kube.cert ? [{ cert: kube.cert, key: kube.key }] : [],
};

export default function () {
  const catalog = discover();

  describe(`--as-group=${CLUSTER_ADMIN}`, () => {
    const actual = canI(catalog, CLUSTER_ADMIN, PAYMENTS);

    describe('Then', () => {
      expect(actual['can-i * * -A']).to.equal('can-i * * -A = yes');
    });
  });

  describe(`--as-group=${NS_ADMIN} -n ${PAYMENTS}`, () => {
    const actual = canI(catalog, NS_ADMIN, PAYMENTS);

    describe('Then', () => {
      expect(actual[`can-i create pods --subresource=exec -n ${PAYMENTS}`]).to.equal(
        `can-i create pods --subresource=exec -n ${PAYMENTS} = no`,
      );
      expect(actual[`can-i create pods --subresource=portforward -n ${PAYMENTS}`]).to.equal(
        `can-i create pods --subresource=portforward -n ${PAYMENTS} = no`,
      );
      expect(actual[`can-i get secrets -n ${PAYMENTS}`]).to.equal(`can-i get secrets -n ${PAYMENTS} = yes`);
    });
  });

  describe(`--as-group=${NS_VIEWER} -n ${PAYMENTS}`, () => {
    const actual = canI(catalog, NS_VIEWER, PAYMENTS);

    describe('Then', () => {
      expect(actual[`can-i create pods --subresource=exec -n ${PAYMENTS}`]).to.equal(
        `can-i create pods --subresource=exec -n ${PAYMENTS} = no`,
      );
      expect(actual[`can-i create pods --subresource=portforward -n ${PAYMENTS}`]).to.equal(
        `can-i create pods --subresource=portforward -n ${PAYMENTS} = no`,
      );
      expect(actual[`can-i get secrets -n ${PAYMENTS}`]).to.equal(`can-i get secrets -n ${PAYMENTS} = no`);
      expect(actual[`can-i create pods -n ${PAYMENTS}`]).to.equal(`can-i create pods -n ${PAYMENTS} = no`);
      expect(actual[`can-i delete pods -n ${PAYMENTS}`]).to.equal(`can-i delete pods -n ${PAYMENTS} = no`);
      expect(actual[`can-i deletecollection pods -n ${PAYMENTS}`]).to.equal(
        `can-i deletecollection pods -n ${PAYMENTS} = no`,
      );
      expect(actual[`can-i patch pods -n ${PAYMENTS}`]).to.equal(`can-i patch pods -n ${PAYMENTS} = no`);
      expect(actual[`can-i update pods -n ${PAYMENTS}`]).to.equal(`can-i update pods -n ${PAYMENTS} = no`);
    });
  });
}

function discover() {
  function get(path) {
    const res = http.get(kube.server + path, { timeout: '30s', headers: kube.headers });
    if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }

  function items(group, list) {
    const result = [];
    for (const item of list.resources) {
      const [resource, subresource = ''] = item.name.split('/');
      result.push({
        group,
        resource,
        subresource,
        namespaced: item.namespaced,
        verbs: item.verbs,
      });
    }
    return result;
  }

  const core = get('/api/v1');
  const groups = get('/apis').groups;
  const groupCatalog = [];
  for (const group of groups) {
    const resources = get(`/apis/${group.preferredVersion.groupVersion}`);
    groupCatalog.push({
      group: group.name,
      resources: items(group.name, resources),
    });
  }

  const coreCatalog = items('', core);
  return { core: coreCatalog, groups: groupCatalog };
}

function canI(catalog, asGroup, namespace) {
  const actual = { 'can-i': '' };
  console.log(`--as=${USER} --as-group=${asGroup} -n ${namespace}`);

  function check(item, scope) {
    const type = item.group ? `${item.resource}.${item.group}` : item.resource;
    const allNamespaces = scope === 'A';
    const namespaced = scope === 'none' ? false : !allNamespaces && item.namespaced;

    for (const verb of item.verbs) {
      const review = {
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SubjectAccessReview',
        spec: {
          user: USER,
          groups: [asGroup],
          resourceAttributes: {
            group: item.group,
            resource: item.resource,
            subresource: item.subresource,
            verb,
            namespace: namespaced ? namespace : '',
          },
        },
      };

      const res = http.post(
        kube.server + '/apis/authorization.k8s.io/v1/subjectaccessreviews',
        JSON.stringify(review),
        {
          timeout: '30s',
          headers: Object.assign({ 'Content-Type': 'application/json' }, kube.headers),
        },
      );
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`POST subjectaccessreviews ${verb} ${type} -> ${res.status}`);
      }

      const status = res.json().status;
      const allowed = status && status.allowed ? 'yes' : 'no';
      let question = `can-i ${verb} ${type}`;
      if (item.subresource) question += ` --subresource=${item.subresource}`;
      if (allNamespaces) question += ' -A';
      else if (namespaced) question += ` -n ${namespace}`;
      const line = `${question} = ${allowed}`;
      actual[question] = line;
      actual['can-i'] += `${line}\n`;
      console.log(`${question} --as=${USER} --as-group=${asGroup} = ${allowed}`);
    }
  }

  for (const item of catalog.core) check(item);
  for (const group of catalog.groups) {
    for (const item of group.resources) check(item);
  }
  check({ group: '', resource: '*', subresource: '', namespaced: true, verbs: ['*'] }, 'A');
  check({ group: '', resource: 'pods', subresource: '', namespaced: true, verbs: ['get'] }, 'A');
  check({ group: '', resource: 'pods', subresource: '', namespaced: true, verbs: ['*'] });
  check({ group: 'apps', resource: 'deployments', subresource: '', namespaced: true, verbs: ['*'] });
  return actual;
}
