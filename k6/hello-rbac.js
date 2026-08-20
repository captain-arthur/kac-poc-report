import http from 'k6/http';
import encoding from 'k6/encoding';
import chai, { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs';

chai.config.aggregateChecks = false;

const USER = 'kac-can-i';
const GROUP = 't-rbac-kac-cluster-admin';
const NAMESPACE = 'rbac-test';

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
  describe(`as group ${GROUP} in namespace ${NAMESPACE}`, () => {
    const catalog = discover();
    const actual = canI(catalog, GROUP, NAMESPACE);

    describe('Then', () => {
      expect(actual['can-i get pods']).to.equal('can-i get pods = yes');
      expect(actual['can-i create pods']).to.equal('can-i create pods = yes');
      expect(actual['can-i delete pods']).to.equal('can-i delete pods = no');
      expect(actual['can-i create pods/exec']).to.equal('can-i create pods/exec = yes');
      expect(actual['can-i get prioritylevelconfigurations.flowcontrol.apiserver.k8s.io']).to.equal('can-i get prioritylevelconfigurations.flowcontrol.apiserver.k8s.io = yes');
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
  const actual = {};

  function check(item) {
    const group = item.group || 'core';
    const name = item.subresource ? `${item.resource}/${item.subresource}` : item.resource;
    const resource = group === 'core' ? name : `${name}.${group}`;

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
            namespace: item.namespaced ? namespace : '',
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
        throw new Error(`POST subjectaccessreviews ${verb} ${name} -> ${res.status}`);
      }

      const status = res.json().status;
      const allowed = status && status.allowed ? 'yes' : 'no';
      const question = `can-i ${verb} ${resource}`;
      const line = `${question} = ${allowed}`;
      actual[question] = line;
      console.log(line);
    }
  }

  for (const item of catalog.core) check(item);
  for (const group of catalog.groups) {
    for (const item of group.resources) check(item);
  }
  return actual;
}
